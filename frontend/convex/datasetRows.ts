import { query, internalMutation, internalQuery } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { assertRowInDataset, loadReadableDataset } from "./lib/authz.js";
import { consumeQuotaForDataset } from "./lib/quota.js";

const DEFAULT_MAX_DATASET_ROWS = 100;

/**
 * Authoritative row count for a dataset. O(N), so use only on the slow
 * paths: self-heal in `insert` / `remove` when the dataset doc predates
 * the `rowCount` field, or the explicit `datasets.backfillRowCounts`
 * migration. Steady-state writes hit the cached counter and never call
 * this.
 */
async function actualRowCount(
  ctx: MutationCtx,
  datasetId: Id<"datasets">,
): Promise<number> {
  const rows = await ctx.db
    .query("datasetRows")
    .withIndex("by_dataset", (q) => q.eq("datasetId", datasetId))
    .collect();
  return rows.length;
}

/**
 * Read all rows of a dataset.
 *
 * Authorized via the parent dataset: caller must be the owner, or the
 * dataset must be public. `loadReadableDataset` returns a uniform
 * "Dataset not found" for both missing and unauthorized — see authz.ts.
 */
export const listByDataset = query({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    await loadReadableDataset(ctx, args.datasetId);

    return await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

export const listByOwnedDatasetInternal = internalQuery({
  args: {
    datasetId: v.id("datasets"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.ownerId !== args.ownerId) return null;

    return await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

/**
 * Filtered row query — applies a single column=value filter server-side
 * before returning rows.
 *
 * Supports two match modes:
 *   - "contains" : case-insensitive substring match (default)
 *   - "exact"    : case-insensitive full-string equality
 *
 * Passing `null` for the filter argument returns all rows identically to
 * `listByDataset`, which lets the frontend reuse one stable query hook.
 *
 * PERFORMANCE NOTE: `datasetRows.data` is a `v.record(v.string(), v.any())`
 * and is not indexed per-field. The filter loop performs a full scan over
 * every row in the dataset. This is acceptable for datasets up to ~100 k
 * rows but will become a bottleneck at scale. A future optimisation would
 * layer in a Convex vector index or a dedicated search table.
 */
export const listByDatasetFiltered = query({
  args: {
    datasetId: v.id("datasets"),
    /**
     * Single filter predicate, or `null` to return all rows.
     * A `null` filter is treated identically to calling `listByDataset`.
     */
    filter: v.nullable(
      v.object({
        column: v.string(),
        value: v.string(),
        matchType: v.optional(
          v.union(v.literal("contains"), v.literal("exact")),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await loadReadableDataset(ctx, args.datasetId);

    const rows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();

    if (!args.filter || args.filter.value === undefined || args.filter.value === null || args.filter.value === "") return rows;

    const { column, value, matchType = "contains" } = args.filter;
    const cellStr = (v: unknown) => String(v ?? "").toLowerCase();
    const searchVal = value.toLowerCase();

    return rows.filter((row) => {
      const cell = row.data[column];
      if (cell == null) return false;
      const s = cellStr(cell);
      return matchType === "exact" ? s === searchVal : s.includes(searchVal);
    });
  },
});

/**
 * Row writes are SYSTEM-LEVEL operations performed by the agent runner,
 * never by end users directly. They are exposed as `internalMutation` so
 * they cannot be called from the browser — only from other Convex
 * functions or from a trusted backend authenticated with the Convex
 * admin key.
 *
 * Quota: every row write charges the dataset's owner exactly once (see
 * convex/lib/quota.ts). System-owned datasets bypass quota. The charge
 * happens BEFORE the write in the same transaction, so failed writes
 * never consume quota.
 *
 * If user-facing row editing is ever introduced, add a separate purpose-
 * built public mutation (e.g. `userEditCell`) that performs ownership
 * checks via `loadOwnedDataset` first AND calls `consumeQuotaForRow`.
 * Do not relax these to public.
 */
export const insert = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    data: v.record(v.string(), v.any()),
    sources: v.optional(v.array(v.string())),
    rowSummary: v.optional(v.string()),
    howFound: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) throw new Error("Dataset not found");

    const previousCount =
      typeof dataset.rowCount === "number"
        ? dataset.rowCount
        : await actualRowCount(ctx, args.datasetId);
    const maxRowCount = dataset.maxRowCount ?? DEFAULT_MAX_DATASET_ROWS;
    if (previousCount >= maxRowCount) {
      throw new Error(
        `Row limit reached: this BigSet dataset is capped at ${maxRowCount} rows. Stop inserting rows and finish the run.`,
      );
    }

    // Dedup: reject inserts that collide on primary key columns.
    // Runs BEFORE quota so rejected dupes don't burn quota.
    const pkColumns = (dataset.columns ?? []).filter(
      (c: { isPrimaryKey?: boolean }) => c.isPrimaryKey,
    );
    if (pkColumns.length > 0) {
      const existingRows = await ctx.db
        .query("datasetRows")
        .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
        .collect();

      const isDuplicate = existingRows.some((existing) => {
        const existingData = existing.data as Record<string, unknown>;
        return pkColumns.every((pk: { name: string }) => {
          const newVal = args.data[pk.name];
          const existingVal = existingData[pk.name];
          return (
            newVal !== undefined &&
            newVal !== "" &&
            existingVal !== undefined &&
            existingVal !== "" &&
            String(newVal).toLowerCase() === String(existingVal).toLowerCase()
          );
        });
      });

      if (isDuplicate) {
        const pkDesc = pkColumns
          .map((pk: { name: string }) => `${pk.name}="${args.data[pk.name]}"`)
          .join(", ");
        throw new Error(
          `Duplicate: a row with ${pkDesc} already exists. Skipping insert.`,
        );
      }
    }

    // Quota consumption only happens for genuine new rows.
    await consumeQuotaForDataset(ctx, args.datasetId, 1);

    const rowId = await ctx.db.insert("datasetRows", args);

    await ctx.db.patch(args.datasetId, { rowCount: previousCount + 1 });

    return rowId;
  },
});

/**
 * Update a row by id. Capability-scoped: the caller MUST pass the
 * dataset this row is expected to belong to. If the row doesn't exist
 * or belongs to a different dataset, throws `"Row not found"` (uniform
 * with the existence-oracle policy in lib/authz.ts).
 *
 * Why `expectedDatasetId` is required, not optional:
 *   - The only callers are system-trusted code paths (the populate agent,
 *     future scheduled refreshers). Each operates with a single
 *     authorized dataset in scope.
 *   - Making it required forces every caller to think about which
 *     dataset they're writing to. A future caller that forgot the scope
 *     hits a TypeScript error, not a security hole.
 */
export const update = internalMutation({
  args: {
    id: v.id("datasetRows"),
    expectedDatasetId: v.id("datasets"),
    data: v.record(v.string(), v.any()),
    sources: v.optional(v.array(v.string())),
    rowSummary: v.optional(v.string()),
    howFound: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await assertRowInDataset(
      ctx,
      args.id,
      args.expectedDatasetId,
    );

    await consumeQuotaForDataset(ctx, args.expectedDatasetId, 1);

    const oldData = existing.data as Record<string, unknown>;
    const newData = args.data;
    for (const [key, newVal] of Object.entries(newData)) {
      const oldVal = oldData[key];
      if (String(oldVal) !== String(newVal)) {
        await ctx.db.insert("datasetHistory", {
          datasetRowId: args.id,
          columnName: key,
          oldValue: String(oldVal ?? ""),
          newValue: String(newVal ?? ""),
          changedAt: Date.now(),
        });
      }
    }

    const patch: Record<string, unknown> = {
      data: newData,
      updateStatus: undefined,
    };
    if (args.sources !== undefined) patch.sources = args.sources;
    if (args.rowSummary !== undefined) patch.rowSummary = args.rowSummary;
    if (args.howFound !== undefined) patch.howFound = args.howFound;
    await ctx.db.patch(args.id, patch);
  },
});

export const clearByDataset = internalMutation({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    // Reset the cached counter. We know the post-state exactly, so this
    // doesn't need the read-then-add dance that `insert` / `remove` use.
    await ctx.db.patch(args.datasetId, { rowCount: 0 });
    return rows.length;
  },
});

export const get = internalQuery({
  args: { id: v.id("datasetRows") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Admin-only row count for a dataset. Used by the backend after a populate
 * workflow completes to decide whether to send the "Your dataset is ready"
 * email — only sent when at least one row exists.
 *
 * Exposed as `internalQuery` rather than reusing `api.datasetRows.listByDataset`
 * because that query runs through `loadReadableDataset` which requires
 * either ownership or visibility="public" — neither holds when the backend
 * uses admin auth without an identity context.
 */
export const countByDataset = internalQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    return rows.length;
  },
});

/**
 * Delete a row by id. Capability-scoped just like `update` above: caller
 * MUST pass the dataset this row is expected to belong to. Throws
 * `"Row not found"` if the row is missing or lives in a different dataset
 * (uniform error — no existence oracle for prompt-injected models).
 *
 * Deletions are NOT quota-charged: quota measures generative cost (rows
 * the agent had to discover + author), not cleanup. A user-facing future
 * caller could still apply its own quota policy.
 */
export const remove = internalMutation({
  args: {
    id: v.id("datasetRows"),
    expectedDatasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    await assertRowInDataset(ctx, args.id, args.expectedDatasetId);

    // Decrement the cached counter, self-healing if the dataset doc
    // predates the rowCount field. `dataset` is guaranteed to exist —
    // assertRowInDataset above verified the row belongs to it.
    const dataset = await ctx.db.get(args.expectedDatasetId);
    if (dataset) {
      const previousCount =
        typeof dataset.rowCount === "number"
          ? dataset.rowCount
          : await actualRowCount(ctx, args.expectedDatasetId);
      await ctx.db.patch(args.expectedDatasetId, {
        // clamp at 0 as a paranoid guard — counter should never go
        // negative because we just confirmed the row exists, but a bug
        // that drove it negative would manifest as an even weirder UI.
        rowCount: Math.max(0, previousCount - 1),
      });
    }

    await ctx.db.delete(args.id);
  },
});

export const markForUpdate = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    rowIds: v.optional(v.array(v.id("datasetRows"))),
  },
  handler: async (ctx, args) => {
    if (args.rowIds && args.rowIds.length > 0) {
      let marked = 0;
      for (const rowId of args.rowIds) {
        const row = await ctx.db.get(rowId);
        if (row && row.datasetId === args.datasetId) {
          await ctx.db.patch(rowId, { updateStatus: "pending" as const });
          marked++;
        }
      }
      return marked;
    }
    const rows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, { updateStatus: "pending" as const });
    }
    return rows.length;
  },
});

export const clearUpdateStatus = internalMutation({
  args: {
    id: v.id("datasetRows"),
    expectedDatasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    await assertRowInDataset(ctx, args.id, args.expectedDatasetId);
    await ctx.db.patch(args.id, { updateStatus: undefined });
  },
});

/**
 * Bulk-clear all pending update statuses for a dataset.
 *
 * Called when a user stops an in-flight update workflow. Workers exit early
 * via AbortError, so rows they never reached still have `updateStatus:
 * "pending"`. This clears them so the UI doesn't show stale shimmer
 * indicators after the run is marked live.
 *
 * Uses the `by_dataset_update_status` compound index so only the pending
 * rows are scanned — the query never touches rows that have already been
 * processed (updateStatus === undefined).
 */
export const clearAllPendingUpdateStatus = internalMutation({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const pendingRows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset_update_status", (q) =>
        q.eq("datasetId", args.datasetId).eq("updateStatus", "pending"),
      )
      .collect();
    for (const row of pendingRows) {
      await ctx.db.patch(row._id, { updateStatus: undefined });
    }
    return pendingRows.length;
  },
});

/**
 * Admin-only row listing for a dataset. Used by the populate agent's
 * `list_rows` tool to see what's already been inserted in the dataset
 * it's authorized for (so the LLM can diff/append rather than dup).
 *
 * Exposed as `internalQuery` for the same reason as `countByDataset`:
 * the backend has admin auth but no user identity, so the public
 * `listByDataset` (which goes through `loadReadableDataset`) would
 * reject it as `anonymous_private`.
 *
 * Caller is responsible for passing the dataset id it's scoped to —
 * at the tool layer, that id is captured by closure, not LLM-supplied,
 * so the agent can't read other users' rows even via prompt injection.
 */
export const listInternal = internalQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});
