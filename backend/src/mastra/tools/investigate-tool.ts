import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { convex, internal } from "../../convex.js";
import { buildInvestigateAgent } from "../agents/investigate.js";
import type { AuthContext } from "../workflows/populate.js";
import type { PopulateColumn } from "../../pipeline/populate.js";
import type { RunMetrics } from "../run-metrics.js";
import { getSignal } from "../../abort-registry.js";
import type { LlmProviderConfig } from "../../config/llm.js";

const keyValueSchema = z.object({
  column: z.string().min(1),
  value: z.string().min(1),
});

const investigateInputSchema = z.object({
  entity_hint: z
    .string()
    .describe(
      "What entity to look for, e.g. 'head of GTM at Appcharge' or 'Starbucks coffee products on Amazon'",
    ),
  primary_keys: z
    .array(keyValueSchema)
    .min(1, "primary_keys must include at least one primary-key value")
    .describe(
      'REQUIRED: primary key values as {"column": "column_name", "value": "value"} entries. e.g. [{"column": "company_name", "value": "Stripe"}]. You MUST provide at least the primary key values you have found.',
    ),
  context: z
    .string()
    .describe(
      "All partial data already found: field values, URLs, snippets from search results",
    ),
  urls: z
    .array(z.string())
    .optional()
    .describe("Pages that likely contain this row's data — pass anything promising"),
  notes: z
    .string()
    .optional()
    .describe(
      "Extra clues from previous subagents or the orchestrator that might help",
    ),
});

const investigateOutputSchema = z.object({
  inserted: z.boolean(),
  row_summary: z.string().optional(),
  clues: z.string().optional(),
  reason: z.string(),
});

function parseInvestigateResult(
  text: string,
): z.infer<typeof investigateOutputSchema> {
  const insertedMatch = text.match(/INSERTED:\s*(true|false)/i);
  const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=\nCLUES:|\nREASON:|$)/is);
  const cluesMatch = text.match(/CLUES:\s*(.+?)(?=\nREASON:|$)/is);
  const reasonMatch = text.match(/REASON:\s*(.+?)$/is);

  return {
    inserted: insertedMatch?.[1]?.toLowerCase() === "true",
    row_summary: summaryMatch?.[1]?.trim() || undefined,
    clues: cluesMatch?.[1]?.trim() || undefined,
    reason: reasonMatch?.[1]?.trim() || text.slice(0, 300),
  };
}

/**
 * Build the run_subagent tool scoped to one dataset.
 *
 * The orchestrator calls this to hand off a lead to a fresh subagent.
 * The subagent does deep research, inserts at most one row, and returns
 * structured feedback including clues for finding more rows.
 *
 * authorizedDatasetId and authContext are captured by closure — not
 * exposed in the tool schema, never visible to the orchestrator LLM.
 */
export function buildSubagentTool(
  authorizedDatasetId: string,
  authContext: AuthContext,
  columns: PopulateColumn[],
  llmConfig: LlmProviderConfig,
  maxRowCount: number,
  metrics?: RunMetrics,
) {
  return createTool({
    id: "run_subagent",
    description:
      "Hand off a lead to a subagent that will research it deeply and insert a single row if it finds real, verified data. You MUST pass the primary key values (primary_keys) for the entity — the subagent will fill in the remaining columns. Also pass any URLs and context you have found.",
    inputSchema: investigateInputSchema,
    outputSchema: investigateOutputSchema,
    execute: async ({ entity_hint, primary_keys, context, urls, notes }) => {
      try {
        const rowCount = await convex.query(internal.datasetRows.countByDataset, {
          datasetId: authorizedDatasetId,
        });
        if (rowCount >= maxRowCount) {
          return {
            inserted: false,
            reason: `ROW_LIMIT_REACHED: this BigSet dataset is capped at ${maxRowCount} rows. Stop calling run_subagent and finish the run.`,
            row_summary: undefined,
            clues: undefined,
          };
        }

        if (metrics) metrics.investigateCalls++;

        console.log(
          `[run_subagent] spawning subagent user=${authContext.authorizedUserId} run=${authContext.workflowRunId} dataset=${authorizedDatasetId} entity="${entity_hint}" pk=${JSON.stringify(primary_keys)}`,
        );

        const agent = buildInvestigateAgent(
          authorizedDatasetId,
          authContext,
          columns,
          llmConfig,
        );

        const pkBlock = primary_keys
          .map(({ column, value }) => `- ${column}: ${value}`)
          .join("\n");
        const urlsBlock =
          urls && urls.length > 0
            ? `\nUseful URLs to start from:\n${urls.map((u) => `- ${u}`).join("\n")}`
            : "";
        const notesBlock = notes ? `\nAdditional notes: ${notes}` : "";

        const prompt = `Research this entity and insert a row if you find real, verified data.

Entity: ${entity_hint}

Primary key values (MUST be included in insert_row):
${pkBlock}

Context (partial data already found):
${context}${urlsBlock}${notesBlock}`;

        const abortSignal = getSignal(authorizedDatasetId);
        const result = await agent.generate(prompt, { abortSignal, maxSteps: 25 });
        if (metrics) {
          // Use result.toolCalls (the flat accumulated list across all steps) rather
          // than iterating result.steps[n].toolCalls. The per-step arrays are snapshots
          // captured at step-finish time; tool-call chunks that arrive after their
          // step-finish event end up attributed to the wrong step, causing systematic
          // miscounts. result.toolCalls is the authoritative list maintained by Mastra's
          // stream processor as chunks arrive.
          metrics.countToolCalls(result.toolCalls ?? []);
          metrics.addInvestigateResult(result);
        }

        const parsed = parseInvestigateResult(result.text);
        if (metrics && parsed.inserted) metrics.rowsInserted++;

        console.log(
          `[run_subagent] done entity="${entity_hint}" inserted=${parsed.inserted} steps=${result.steps?.length ?? "?"} toolCalls=${result.toolCalls?.length ?? "?"}` +
            (parsed.row_summary ? `\n  summary: ${parsed.row_summary}` : "") +
            (parsed.reason ? `\n  reason:  ${parsed.reason}` : "") +
            (parsed.clues ? `\n  clues:   ${parsed.clues}` : ""),
        );
        return parsed;
      } catch (err) {
        // Only propagate an AbortError if OUR signal was actually fired (i.e.
        // the user pressed Stop). Network errors in Node.js can also surface as
        // AbortError — re-throwing those would cause the orchestrator's
        // agent.generate() to exit early and return a graceful empty result,
        // producing a "0 rows" run without any user action.
        if (err instanceof Error && err.name === "AbortError" && getSignal(authorizedDatasetId)?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[run_subagent] subagent error entity="${entity_hint}" err=${msg}`);
        return {
          inserted: false,
          reason: `Subagent failed: ${msg}`,
          row_summary: undefined,
          clues: undefined,
        };
      }
    },
  });
}
