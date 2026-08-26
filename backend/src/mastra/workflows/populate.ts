import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { generateText } from "ai";
import { datasetContextSchema, populateColumnSchema } from "../../pipeline/populate.js";
import { convex, internal } from "../../convex.js";
import { DEFAULT_MODEL_IDS } from "../../config/models.js";
import { REASONING_LEVELS, createLanguageModel } from "../../config/llm.js";
import { requireLlmProviderConfig } from "../../local-credentials.js";
import { buildPopulateAgent } from "../agents/populate.js";
import { RunMetrics } from "../run-metrics.js";
import { saveRunMetrics } from "../save-run-metrics.js";
import { getSignal } from "../../abort-registry.js";

/**
 * Server-set auth/run context threaded through every step.
 *
 * The HTTP route (`/populate` in `src/index.ts`) fills this in from the
 * verified Clerk JWT and the Mastra run handle BEFORE calling
 * `workflow.start()`. The client cannot supply these fields — they live
 * on the workflow input but not on `datasetContextSchema`, which is what
 * the route validates against `req.body`.
 *
 * Carried to:
 *   - `buildPopulateAgent(...)` (via `authContext`) so the dataset tools
 *     can attach caller attribution to security/observability logs and
 *     PostHog capability-violation events.
 *
 * `workflowRunId` is intentionally a plain string so callers can pass
 * whatever id the orchestration layer gave them (Mastra run id, or a
 * fresh UUID as a fallback) without coupling this schema to a specific
 * runtime.
 */
/**
 * One role's resolved model plus the reasoning level it should run at. The
 * level travels with the model so every agent built during the run uses the
 * same setting the request resolved, rather than re-reading config mid-run.
 */
const modelRoleSchema = z.object({
  model: z.string().min(1),
  reasoning: z.enum(REASONING_LEVELS),
});

export const authContextSchema = z.object({
  authorizedUserId: z.string().min(1),
  workflowRunId: z.string().min(1),
  modelConfig: z.object({
    schemaInference: modelRoleSchema,
    populateOrchestrator: modelRoleSchema,
    investigateSubagent: modelRoleSchema,
  }),
  isBenchmark: z.boolean().optional(),
});
export type AuthContext = z.infer<typeof authContextSchema>;

export const populateInputSchema = datasetContextSchema.extend({
  authContext: authContextSchema,
});
export type PopulateInput = z.infer<typeof populateInputSchema>;

const clearRowsStep = createStep({
  id: "clear-rows",
  inputSchema: populateInputSchema,
  outputSchema: populateInputSchema,
  execute: async ({ inputData }) => {
    console.log(`[clear-rows] Clearing rows for dataset ${inputData.datasetId}`);
    await convex.mutation(internal.datasetRows.clearByDataset, {
      datasetId: inputData.datasetId,
    });
    console.log(`[clear-rows] Done`);
    return inputData;
  },
});

const enumerationOutputSchema = populateInputSchema.extend({
  enumerationStrategy: z.enum(["scraper", "search"]),
  manifest: z.array(z.record(z.string(), z.string())),
  sourceUrl: z.string().optional(),
});

const enumerateStep = createStep({
  id: "enumerate",
  inputSchema: populateInputSchema,
  outputSchema: enumerationOutputSchema,
  execute: async ({ inputData }) => {
    console.log(`[enumerate] Classifying dataset ${inputData.datasetId}`);

    const dataset = await convex.query(internal.datasets.getInternal, {
      id: inputData.datasetId,
    });

    const retrievalStrategy = (dataset as Record<string, unknown>)?.retrievalStrategy as string ?? "search_fetch";
    const sourceHint = (dataset as Record<string, unknown>)?.sourceHint as string ?? "";

    const pkColumns = inputData.columns.filter((c) => c.isPrimaryKey);
    const columnsDesc = inputData.columns
      .map(
        (c) =>
          `- "${c.name}" (${c.type})${c.isPrimaryKey ? " [PK]" : ""}${c.description ? `: ${c.description}` : ""}`,
      )
      .join("\n");

    const classificationPrompt = `You are classifying a dataset's enumeration strategy.

Dataset: ${inputData.datasetName}
Description: ${inputData.description}
Retrieval strategy hint: ${retrievalStrategy}
Source hint: ${sourceHint}
Primary key columns: ${pkColumns.map((c) => c.name).join(", ") || "none"}

Columns:
${columnsDesc}

Can ALL primary key values for this dataset be enumerated from a single source URL (a directory page, registry, listing, catalog, or API)?

Answer "scraper" if yes — a single source lists all entities (e.g. YC company directory, Wikipedia list pages, product catalogs, government registries).
Answer "search" if no — entities must be discovered through broad web searches with no single authoritative listing.

Respond with EXACTLY one word: scraper or search`;

    let classification: "scraper" | "search" = "search";
    try {
      const llmConfig = await requireLlmProviderConfig();
      const modelSlug =
        inputData.authContext?.modelConfig?.schemaInference.model ?? llmConfig.defaultModel ?? DEFAULT_MODEL_IDS.SCHEMA_INFERENCE;
      const result = await generateText({
        model: createLanguageModel(
          llmConfig,
          modelSlug,
          inputData.authContext?.modelConfig?.schemaInference.reasoning,
        ),
        prompt: classificationPrompt,
        maxOutputTokens: 10,
        abortSignal: getSignal(inputData.datasetId),
      });
      const answer = result.text.trim().toLowerCase();
      if (answer === "scraper" || answer === "search") {
        classification = answer;
      } else {
        console.warn(`[enumerate] Unexpected classification "${answer}", defaulting to "search"`);
      }
    } catch (err) {
      // Only re-throw if OUR signal was actually fired. A spurious network
      // AbortError should fall through and default to "search" as before.
      if (err instanceof Error && err.name === "AbortError" && getSignal(inputData.datasetId)?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[enumerate] Classification failed: ${msg}, defaulting to "search"`);
    }

    if (classification === "scraper") {
      console.log(
        `[enumerate] Classified as SCRAPER (source: ${sourceHint}). Stub: empty manifest, falling through to search.`,
      );
    } else {
      console.log(`[enumerate] Classified as SEARCH. Proceeding with fan-out.`);
    }

    return {
      ...inputData,
      enumerationStrategy: classification,
      manifest: [],
      sourceUrl: classification === "scraper" ? sourceHint || undefined : undefined,
    };
  },
});

const buildPromptOutputSchema = z.object({
  prompt: z.string(),
  // Threaded through so the agent step can build a dataset-scoped agent.
  // The LLM never sees these fields — they stay in the workflow envelope.
  authorizedDatasetId: z.string(),
  authContext: authContextSchema,
  columns: z.array(populateColumnSchema),
  maxRowCount: z.number().int().min(1),
});

const buildPromptStep = createStep({
  id: "build-prompt",
  inputSchema: enumerationOutputSchema,
  outputSchema: buildPromptOutputSchema,
  execute: async ({ inputData }) => {
    const pkColumns = inputData.columns.filter((c) => c.isPrimaryKey);
    const columnsDesc = inputData.columns
      .map(
        (c) =>
          `- "${c.name}" (${c.type})${c.isPrimaryKey ? " [PRIMARY KEY]" : ""}${c.description ? `: ${c.description}` : ""}`,
      )
      .join("\n");

    const pkNote =
      pkColumns.length > 0
        ? `\nPrimary key column(s): ${pkColumns.map((c) => `"${c.name}"`).join(", ")}. When calling run_subagent, you MUST pass these values in the primary_keys field as an array of {"column": "column_name", "value": "value"} entries. The subagent will research and fill in the remaining columns.`
        : "";

    let manifestNote = "";
    if (inputData.manifest.length > 0) {
      const manifestList = inputData.manifest
        .map((entry) =>
          Object.entries(entry)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", "),
        )
        .join("\n  - ");
      manifestNote = `\n\nPre-discovered entities (already enumerated — go straight to investigating these):\n  - ${manifestList}`;
    }

    let strategyNote = "";
    if (inputData.enumerationStrategy === "scraper" && inputData.manifest.length === 0) {
      strategyNote = `\n\nNote: This dataset has an authoritative source${inputData.sourceUrl ? ` (${inputData.sourceUrl})` : ""}. Start your search there — it likely contains a directory or listing of all entities.`;
    }

    const prompt = `Dataset: ${inputData.datasetName}
Description: ${inputData.description}

Data fields to collect:
${columnsDesc}${pkNote}${manifestNote}${strategyNote}

Search the web broadly to find real entities that fit this dataset topic.
For each lead you find, call run_subagent with the primary key values and any context/URLs you have found.
Example primary_keys format: [{"column": "company_name", "value": "Stripe"}]
If run_subagent returns ROW_LIMIT_REACHED, stop immediately and do not make any more tool calls.
Stop the populate run as soon as the dataset reaches ${inputData.maxRowCount} rows.`;

    console.log(
      `[build-prompt] Built prompt for ${inputData.datasetName} (${inputData.columns.length} columns, strategy=${inputData.enumerationStrategy})`,
    );
    return {
      prompt,
      authorizedDatasetId: inputData.datasetId,
      authContext: inputData.authContext,
      columns: inputData.columns,
      maxRowCount: inputData.maxRowCount,
    };
  },
});

/**
 * Custom agent step.
 *
 * We can't use `createStep(populateAgent, { maxSteps: 80 })` anymore
 * because the agent is no longer a module-level singleton — it has to be
 * built per-run with the authorized dataset baked into its tools (closure
 * capability scope; see tools/dataset-tools.ts). So this step does what
 * Mastra's agent-as-step adapter would do internally: build the agent,
 * call `.generate(prompt, { maxSteps })`, return the text.
 *
 * A RunMetrics instance is created here, threaded into every tool factory
 * and agent builder, and saved to Convex in the finally block. The save is
 * fire-and-forget — errors are logged but never propagate to the workflow.
 */
const agentStep = createStep({
  id: "populate-agent",
  inputSchema: buildPromptOutputSchema,
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData }) => {
    const metrics = new RunMetrics();
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    let errorMsg: string | undefined;

    try {
      const agent = buildPopulateAgent(
        inputData.authorizedDatasetId,
        inputData.authContext,
        inputData.columns,
        await requireLlmProviderConfig(),
        inputData.maxRowCount,
        metrics,
      );
      const abortSignal = getSignal(inputData.authorizedDatasetId);
      const result = await agent.generate(inputData.prompt, { abortSignal, maxSteps: 80 });
      metrics.addOrchestratorResult(result);
      // Use result.toolCalls (flat accumulated list) — same reasoning as investigate-tool.ts.
      metrics.countToolCalls(result.toolCalls ?? []);
      return { text: result.text };
    } catch (err) {
      status = "error";
      // Label user-initiated stops clearly in runStats; treat spurious network
      // AbortErrors (signal not fired) as regular failures so the error message
      // doesn't mislead operators into thinking the user pressed Stop.
      if (err instanceof Error && err.name === "AbortError" && getSignal(inputData.authorizedDatasetId)?.aborted) {
        errorMsg = "Stopped by user";
      } else {
        errorMsg = err instanceof Error ? err.message : String(err);
      }
      console.error(`[populate-agent] agent.generate failed: ${errorMsg}`);
      throw err;
    } finally {
      const finishedAt = Date.now();
      void saveRunMetrics({
        workflowRunId: inputData.authContext.workflowRunId,
        datasetId: inputData.authorizedDatasetId,
        userId: inputData.authContext.authorizedUserId,
        startedAt,
        finishedAt,
        metrics,
        status,
        error: errorMsg,
        isBenchmark: inputData.authContext.isBenchmark,
      }).catch((err) =>
        console.error(
          `[populate-agent] metrics save failed run=${inputData.authContext.workflowRunId}:`,
          err,
        ),
      );
    }
  },
});

export const populateWorkflow = createWorkflow({
  id: "populate-workflow",
  inputSchema: populateInputSchema,
  outputSchema: z.object({ text: z.string() }),
})
  .then(clearRowsStep)
  .then(enumerateStep)
  .then(buildPromptStep)
  .then(agentStep)
  .commit();
