import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { datasetContextSchema, populateColumnSchema } from "../../pipeline/populate.js";
import { convex, internal } from "../../convex.js";
import { buildRefreshAgent } from "../agents/refresh.js";
import { authContextSchema } from "./populate.js";
import { requireLlmProviderConfig } from "../../local-credentials.js";
import { RunMetrics } from "../run-metrics.js";
import { saveRunMetrics } from "../save-run-metrics.js";
import { getSignal } from "../../abort-registry.js";

export const updateInputSchema = datasetContextSchema.extend({
  authContext: authContextSchema,
});
export type UpdateInput = z.infer<typeof updateInputSchema>;

const rowSchema = z.object({
  _id: z.string(),
  data: z.record(z.string(), z.any()),
  sources: z.array(z.string()).optional(),
  rowSummary: z.string().optional(),
  howFound: z.string().optional(),
});

const markAndFetchOutputSchema = updateInputSchema.extend({
  rows: z.array(rowSchema),
});

const markAndFetchStep = createStep({
  id: "mark-and-fetch",
  inputSchema: updateInputSchema,
  outputSchema: markAndFetchOutputSchema,
  execute: async ({ inputData }) => {
    const selective = inputData.rowIds && inputData.rowIds.length > 0;
    console.log(
      `[mark-and-fetch] Marking ${selective ? inputData.rowIds!.length : "all"} rows for dataset ${inputData.datasetId}`,
    );

    const markedCount = await convex.mutation(internal.datasetRows.markForUpdate, {
      datasetId: inputData.datasetId,
      ...(selective ? { rowIds: inputData.rowIds } : {}),
    });

    const rawRows = await convex.query(internal.datasetRows.listInternal, {
      datasetId: inputData.datasetId,
    });

    let rows = (rawRows as Record<string, unknown>[]).map((r) => ({
      _id: String(r._id),
      data: (r.data ?? {}) as Record<string, unknown>,
      sources: r.sources as string[] | undefined,
      rowSummary: r.rowSummary as string | undefined,
      howFound: r.howFound as string | undefined,
    }));

    if (selective) {
      const selectedSet = new Set(inputData.rowIds);
      rows = rows.filter((r) => selectedSet.has(r._id));
    }

    console.log(`[mark-and-fetch] Marked ${markedCount}, processing ${rows.length} rows`);
    return { ...inputData, rows };
  },
});

const refreshOutputSchema = z.object({
  updatedCount: z.number(),
  totalCount: z.number(),
  errors: z.number(),
});

const MAX_CONCURRENT = 5;

async function processWithConcurrency<T>(
  items: T[],
  handler: (item: T) => Promise<void>,
  max: number,
): Promise<void> {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(max, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        await handler(items[i]);
      }
    },
  );
  await Promise.allSettled(workers);
}

const refreshRowsStep = createStep({
  id: "refresh-rows",
  inputSchema: markAndFetchOutputSchema,
  outputSchema: refreshOutputSchema,
  execute: async ({ inputData }) => {
    const { datasetId, columns, authContext, rows } = inputData;
    let updatedCount = 0;
    let errors = 0;

    const metrics = new RunMetrics();
    const startedAt = Date.now();
    const llmConfig = await requireLlmProviderConfig();

    const pkColumns = columns.filter((c) => c.isPrimaryKey);

    async function processRow(row: z.infer<typeof rowSchema>) {
      try {
        const agent = buildRefreshAgent(
          datasetId,
          authContext,
          columns,
          llmConfig,
        );

        const pkBlock =
          pkColumns.length > 0
            ? pkColumns
                .map((c) => `- ${c.name}: ${row.data[c.name] ?? ""}`)
                .join("\n")
            : "(no primary keys defined)";
        const existingDataBlock = Object.entries(row.data)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n");
        const sourcesBlock =
          row.sources && row.sources.length > 0
            ? `\nSource URLs to check:\n${row.sources.map((s) => `- ${s}`).join("\n")}`
            : "\nNo source URLs recorded — search the web using the primary key values.";

        const prompt = `Refresh this existing row and update it if the data has changed.

Row ID: ${row._id}

Primary keys:
${pkBlock}

Existing data:
${existingDataBlock}
${sourcesBlock}
${row.rowSummary ? `\nPrevious summary: ${row.rowSummary}` : ""}
${row.howFound ? `\nPreviously found via: ${row.howFound}` : ""}`;

        const abortSignal = getSignal(datasetId);
        const result = await agent.generate(prompt, { abortSignal, maxSteps: 10 });

        // Accumulate token usage into the investigate tier (refresh agents map
        // to the investigate tier so the runStats schema needs no new columns).
        metrics.addRefreshResult(result);

        // Use result.toolCalls (flat accumulated list) — same reasoning as
        // investigate-tool.ts. Per-step arrays are step-finish snapshots and
        // can misattribute chunks that arrive after the step-finish event.
        metrics.countToolCalls(result.toolCalls ?? []);

        // Use a tolerant regex so variants like `"updated":true` or
        // `updated : true` are all caught, not just the exact string
        // "updated: true" that the agent is instructed to produce.
        const updated = /\bupdated"?\s*:\s*true\b/i.test(result.text);
        if (updated) {
          updatedCount++;
          metrics.rowsUpdated++;
        }

        console.log(
          `[refresh-rows] Row ${row._id}: updated=${updated} steps=${result.steps?.length ?? "?"} toolCalls=${(result.toolCalls as any[])?.length ?? "?"}`,
        );
      } catch (err) {
        // Only re-throw if OUR signal was actually fired. Spurious network
        // AbortErrors must not terminate a worker — they should be counted as
        // row errors so the rest of the dataset continues refreshing.
        if (err instanceof Error && err.name === "AbortError" && getSignal(datasetId)?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[refresh-rows] Row ${row._id} failed: ${msg}`,
        );
        errors++;
      } finally {
        try {
          await convex.mutation(internal.datasetRows.clearUpdateStatus, {
            id: row._id,
            expectedDatasetId: datasetId,
          });
        } catch (cleanupErr) {
          const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          if (/not found/i.test(cleanupMsg)) {
            return;
          }
          console.error(`[refresh-rows] Failed to clear update status for row ${row._id}: ${cleanupMsg}`);
        }
      }
    }

    console.log(
      `[refresh-rows] Processing ${rows.length} rows (max ${MAX_CONCURRENT} concurrent)`,
    );
    await processWithConcurrency(rows, processRow, MAX_CONCURRENT);
    const finishedAt = Date.now();

    // If the run was stopped mid-update, workers exited early via AbortError.
    // Rows that were never processed still have updateStatus:"pending".
    // Clear them now so the UI doesn't show stale shimmer indicators.
    const abortSignal = getSignal(datasetId);
    if (abortSignal?.aborted) {
      console.log(`[refresh-rows] Run was stopped — clearing remaining pending row statuses`);
      try {
        await convex.mutation(internal.datasetRows.clearAllPendingUpdateStatus, {
          datasetId,
        });
      } catch (cleanupErr) {
        console.error(`[refresh-rows] Failed to clear pending update statuses: ${cleanupErr}`);
      }
    }

    console.log(
      `[refresh-rows] Done: ${updatedCount} updated, ${errors} errors, ${rows.length - updatedCount - errors} unchanged`,
    );

    // Persist metrics — fire-and-forget; never block the workflow return.
    void saveRunMetrics({
      workflowRunId: authContext.workflowRunId,
      datasetId,
      userId: authContext.authorizedUserId,
      startedAt,
      finishedAt,
      metrics,
      // Total failure: every row errored. Partial failure: some rows errored
      // but at least one succeeded — still "success" overall, but the error
      // field records how many failed so partial issues are visible in the data.
      status: errors > 0 && updatedCount === 0 ? "error" : "success",
      error: errors > 0
        ? `${errors} of ${rows.length} row(s) failed to refresh`
        : undefined,
      workflowType: "update",
    }).catch((err) =>
      console.error(
        `[refresh-rows] metrics save failed run=${authContext.workflowRunId}:`,
        err,
      ),
    );

    return { updatedCount, totalCount: rows.length, errors };
  },
});

export const updateWorkflow = createWorkflow({
  id: "update-workflow",
  inputSchema: updateInputSchema,
  outputSchema: refreshOutputSchema,
})
  .then(markAndFetchStep)
  .then(refreshRowsStep)
  .commit();
