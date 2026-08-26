import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
import type { QueryCtx } from "./_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import {
  assertNotReservedOwner,
  loadOwnedDataset,
  loadReadableDataset,
  requireIdentity,
} from "./lib/authz.js";
import { FREE_TIER_MONTHLY_QUOTA, requireQuotaRemaining } from "./lib/quota.js";
import {
  nextRefreshAtFor,
  refreshCadenceValidator,
  type RefreshCadence,
} from "./lib/refreshScheduling.js";

const columnValidator = v.object({
  name: v.string(),
  type: v.union(
    v.literal("text"),
    v.literal("number"),
    v.literal("boolean"),
    v.literal("url"),
    v.literal("date"),
  ),
  description: v.optional(v.string()),
  isPrimaryKey: v.optional(v.boolean()),
});

function refreshCadenceFromLegacyLabel(
  legacyCadence: string | undefined,
  fallback: RefreshCadence,
): RefreshCadence {
  const normalized = legacyCadence?.trim().toLowerCase();
  switch (normalized) {
    case "every 30 min":
    case "every 30 mins":
    case "every 30 minute":
    case "every 30 minutes":
      return "30m";
    case "every 6 hour":
    case "every 6 hours":
      return "6h";
    case "every 12 hour":
    case "every 12 hours":
      return "12h";
    case "daily":
      return "daily";
    case "weekly":
      return "weekly";
    case "manual":
      return "manual";
    default:
      return fallback;
  }
}

const PREVIEW_ROW_COUNT = 5;
const DEFAULT_MAX_ROW_COUNT = 100;

function validateMaxRowCount(maxRowCount: number): void {
  if (
    !Number.isInteger(maxRowCount) ||
    maxRowCount < 1 ||
    maxRowCount > FREE_TIER_MONTHLY_QUOTA
  ) {
    throw new Error(
      `Max row count must be a whole number between 1 and ${FREE_TIER_MONTHLY_QUOTA}.`,
    );
  }
}

async function attachPreview(ctx: QueryCtx, dataset: Doc<"datasets">) {
  // Mini-table preview: just the first N rows. `.take` keeps the
  // subscription's read set small — the dashboard's reactivity for the
  // row count does NOT depend on this query. It depends on the
  // denormalized `rowCount` field on the dataset doc itself, maintained
  // by datasetRows.{insert,remove,clearByDataset}. That field is part of
  // `dataset`, which is part of the query's read set, so patches to it
  // invalidate the subscription and the card re-renders with the new
  // count even after the first PREVIEW_ROW_COUNT rows.
  const previewRows = await ctx.db
    .query("datasetRows")
    .withIndex("by_dataset", (q) => q.eq("datasetId", dataset._id))
    .take(PREVIEW_ROW_COUNT);
  return {
    ...dataset,
    previewRows: previewRows.map((r) => r.data),
    // Fallback to the preview length only when the dataset doc predates
    // the `rowCount` field. Write paths self-heal on the next insert /
    // remove; `datasets.backfillRowCounts` migrates every doc at once.
    rowCount: dataset.rowCount ?? previewRows.length,
  };
}

/**
 * The signed-in user's own datasets, each with a small preview of rows.
 * Scoped by `ownerId === identity.subject`. Returns [] for users with no
 * datasets — never throws on empty.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const datasets = await ctx.db
      .query("datasets")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .collect();

    return Promise.all(datasets.map((ds) => attachPreview(ctx, ds)));
  },
});

/**
 * Curated public datasets, each with a small preview of rows. Callable
 * WITHOUT authentication — anonymous visitors on the landing page read
 * through this query.
 *
 * Scoped via `by_visibility` index so this stays O(public datasets), not
 * O(all datasets). Ordered by creation time descending so newer curated
 * datasets surface first.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const datasets = await ctx.db
      .query("datasets")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .order("desc")
      .collect();

    return Promise.all(datasets.map((ds) => attachPreview(ctx, ds)));
  },
});

export const get = query({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    return await loadReadableDataset(ctx, args.id);
  },
});

/**
 * Admin-only fetch by id. No authz — returns the raw doc or null. Used
 * by the backend after a populate workflow completes to verify the
 * dataset still exists (delete-race protection) and read its CURRENT
 * name for the email subject (rename protection — the name in the
 * request body could be stale by the time the workflow finishes).
 */
export const getInternal = internalQuery({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Atomically claims a user-requested populate run for a dataset.
 *
 * This is the concurrency gate for backend /populate calls. The workflow
 * starts by clearing existing rows, so duplicate background runs for the same
 * dataset must be rejected before either one reaches the row-clearing step.
 */
export const beginPopulateInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) {
      return { outcome: "not_found" as const };
    }
    if (dataset.ownerId !== args.ownerId) {
      return { outcome: "forbidden" as const };
    }
    if (dataset.status === "building") {
      return { outcome: "already_building" as const };
    }
    if (dataset.status === "updating") {
      return { outcome: "already_updating" as const };
    }

    await ctx.db.patch(dataset._id, {
      status: "building",
      lastStatusError: undefined,
    });
    return { outcome: "started" as const };
  },
});

export const beginUpdateInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) {
      return { outcome: "not_found" as const };
    }
    if (dataset.ownerId !== args.ownerId) {
      return { outcome: "forbidden" as const };
    }
    if (dataset.status === "building") {
      return { outcome: "already_building" as const };
    }
    if (dataset.status === "updating") {
      return { outcome: "already_updating" as const };
    }

    await ctx.db.patch(dataset._id, {
      status: "updating",
      lastStatusError: undefined,
    });
    return { outcome: "started" as const };
  },
});

export const listDueForRefreshInternal = internalQuery({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("datasets")
      .withIndex("by_refresh_due", (q) =>
        q.eq("refreshEnabled", true).lte("nextRefreshAt", args.now),
      )
      .take(Math.min(args.limit ?? 10, 50));
  },
});

export const claimScheduledRefreshInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    now: v.number(),
    runId: v.string(),
    staleAfterMs: v.number(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) return { outcome: "not_found" as const };
    if (!dataset.refreshEnabled || !dataset.refreshCadence || dataset.refreshCadence === "manual") {
      return { outcome: "disabled" as const };
    }
    if (!dataset.nextRefreshAt || dataset.nextRefreshAt > args.now) {
      return { outcome: "not_due" as const };
    }
    if (dataset.status === "building") {
      return { outcome: "already_building" as const };
    }
    if (dataset.status === "updating") {
      const staleScheduledRun =
        dataset.lastRefreshStartedAt !== undefined &&
        dataset.lastRefreshStartedAt + args.staleAfterMs <= args.now;
      if (!staleScheduledRun) {
        return { outcome: "already_updating" as const };
      }
    }

    await ctx.db.patch(dataset._id, {
      status: "updating",
      lastStatusError: undefined,
      lastRefreshStartedAt: args.now,
      lastRefreshRunId: args.runId,
    });

    return {
      outcome: "started" as const,
      dataset: {
        datasetId: dataset._id,
        datasetName: dataset.name,
        description: dataset.description,
        columns: dataset.columns,
        ownerId: dataset.ownerId,
        maxRowCount: dataset.maxRowCount ?? DEFAULT_MAX_ROW_COUNT,
      },
    };
  },
});

export const completeScheduledRefreshInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) return { outcome: "not_found" as const };

    const refreshCadence = dataset.refreshCadence ?? "manual";
    await ctx.db.patch(dataset._id, {
      status: "live",
      lastStatusError: undefined,
      lastRefreshAt: args.now,
      lastRefreshStartedAt: undefined,
      nextRefreshAt: nextRefreshAtFor(refreshCadence, args.now),
    });
    return { outcome: "completed" as const };
  },
});

export const failScheduledRefreshInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    now: v.number(),
    lastStatusError: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) return { outcome: "not_found" as const };

    const refreshCadence = dataset.refreshCadence ?? "manual";
    await ctx.db.patch(dataset._id, {
      status: "failed",
      lastStatusError: args.lastStatusError,
      lastRefreshStartedAt: undefined,
      nextRefreshAt: nextRefreshAtFor(refreshCadence, args.now),
    });
    return { outcome: "failed" as const };
  },
});

/**
 * Admin-only status transition. Used by the backend orchestration layer
 * to move a dataset between lifecycle states after a workflow completes.
 *
 * No authz check — the backend has already verified ownership before
 * reaching here (or is acting as the system on behalf of a scheduled
 * run). This mutation is purely a controlled patch on the `status` field.
 *
 * Lifecycle today:
 *   - "paused"   : default for newly created datasets before first run
 *   - "building" : set by beginPopulateInternal after ownership passes
 *   - "live"     : set by background populate after rows exist
 *   - "failed"   : set by background populate on workflow failure
 *
 * NOTE: the public `datasets.updateStatus` mutation still exists for
 * user-initiated transitions (Pause/Resume) — that one goes through
 * ownership authz. Use this internal version for system writes.
 */
export const setStatusInternal = internalMutation({
  args: {
    id: v.id("datasets"),
    status: v.union(
      v.literal("live"),
      v.literal("paused"),
      v.literal("building"),
      v.literal("updating"),
      v.literal("failed"),
    ),
    lastStatusError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      lastStatusError: args.status === "failed" ? args.lastStatusError : undefined,
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    refreshCadence: refreshCadenceValidator,
    maxRowCount: v.number(),
    columns: v.array(columnValidator),
    retrievalStrategy: v.optional(
      v.union(
        v.literal("search_fetch"),
        v.literal("browser"),
        v.literal("hybrid")
      )
    ),
    sourceHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    assertNotReservedOwner(identity.subject);
    validateMaxRowCount(args.maxRowCount);
    // Block dataset creation at full exhaustion — a dataset you can't
    // populate is just clutter. Row generation later will re-check, so
    // this is a UX safeguard, not the only line of defense.
    await requireQuotaRemaining(ctx, identity.subject, args.maxRowCount);

    return await ctx.db.insert("datasets", {
      ...args,
      ownerId: identity.subject,
      status: "paused",
      visibility: "private",
      rowCount: 0,
      refreshEnabled: args.refreshCadence !== "manual",
      nextRefreshAt: nextRefreshAtFor(args.refreshCadence, Date.now()),
    });
  },
});

export const createForOwnerInternal = internalMutation({
  args: {
    ownerId: v.string(),
    name: v.string(),
    description: v.string(),
    refreshCadence: refreshCadenceValidator,
    maxRowCount: v.number(),
    columns: v.array(columnValidator),
    retrievalStrategy: v.optional(
      v.union(
        v.literal("search_fetch"),
        v.literal("browser"),
        v.literal("hybrid")
      )
    ),
    sourceHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertNotReservedOwner(args.ownerId);
    validateMaxRowCount(args.maxRowCount);
    await requireQuotaRemaining(ctx, args.ownerId, args.maxRowCount);

    return await ctx.db.insert("datasets", {
      ...args,
      status: "paused",
      visibility: "private",
      rowCount: 0,
      refreshEnabled: args.refreshCadence !== "manual",
      nextRefreshAt: nextRefreshAtFor(args.refreshCadence, Date.now()),
    });
  },
});

export const listByOwnerInternal = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("datasets")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .collect();
  },
});

export const getOwnedInternal = internalQuery({
  args: {
    id: v.id("datasets"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset || dataset.ownerId !== args.ownerId) return null;
    return dataset;
  },
});

export const updateRefreshSettings = mutation({
  args: {
    id: v.id("datasets"),
    refreshCadence: refreshCadenceValidator,
  },
  handler: async (ctx, args) => {
    const dataset = await loadOwnedDataset(ctx, args.id);
    const refreshEnabled = args.refreshCadence !== "manual";
    await ctx.db.patch(dataset._id, {
      refreshCadence: args.refreshCadence,
      refreshEnabled,
      nextRefreshAt: refreshEnabled
        ? nextRefreshAtFor(args.refreshCadence, Date.now())
        : undefined,
    });
  },
});

export const updateDetails = mutation({
  args: {
    id: v.id("datasets"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trimmedName = args.name.trim();
    if (!trimmedName) throw new Error("Dataset name cannot be empty");
    const dataset = await loadOwnedDataset(ctx, args.id);

    const nameChanged = trimmedName !== dataset.name;
    const descChanged = args.description !== undefined && args.description !== dataset.description;
    if (!nameChanged && !descChanged) return;

    const patch: Partial<Doc<"datasets">> = { name: trimmedName };
    if (descChanged) patch.description = args.description;
    await ctx.db.patch(dataset._id, patch);
  },
});

export const updateMaxRowCount = mutation({
  args: {
    id: v.id("datasets"),
    maxRowCount: v.number(),
  },
  handler: async (ctx, args) => {
    const dataset = await loadOwnedDataset(ctx, args.id);
    validateMaxRowCount(args.maxRowCount);
    const currentRowCount = dataset.rowCount ?? 0;
    const additionalRowsNeeded = Math.max(0, args.maxRowCount - currentRowCount);
    await requireQuotaRemaining(ctx, dataset.ownerId, additionalRowsNeeded);
    await ctx.db.patch(dataset._id, {
      maxRowCount: args.maxRowCount,
    });
  },
});

export const backfillRefreshSettings = internalMutation({
  args: {
    defaultCadence: v.optional(refreshCadenceValidator),
  },
  handler: async (ctx, args) => {
    const defaultCadence = args.defaultCadence ?? "daily";
    const now = Date.now();
    const datasets = await ctx.db.query("datasets").collect();
    let patched = 0;
    let alreadyCurrent = 0;

    for (const dataset of datasets) {
      if (dataset.refreshCadence) {
        alreadyCurrent++;
        continue;
      }

      const refreshCadence = refreshCadenceFromLegacyLabel(
        dataset.cadence,
        defaultCadence,
      );
      await ctx.db.patch(dataset._id, {
        refreshCadence,
        refreshEnabled: refreshCadence !== "manual",
        nextRefreshAt: nextRefreshAtFor(refreshCadence, now),
      });
      patched++;
    }

    return { patched, alreadyCurrent, total: datasets.length };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("datasets"),
    status: v.union(
      v.literal("live"),
      v.literal("paused"),
      v.literal("building"),
    ),
  },
  handler: async (ctx, args) => {
    const dataset = await loadOwnedDataset(ctx, args.id);
    await ctx.db.patch(dataset._id, { status: args.status });
  },
});

export const remove = mutation({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const dataset = await loadOwnedDataset(ctx, args.id);

    const rows = await ctx.db
      .query("datasetRows")
      .withIndex("by_dataset", (q) => q.eq("datasetId", dataset._id))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(dataset._id);
  },
});

/**
 * One-shot migration: scan every dataset, count its rows, and patch
 * `rowCount` to the true value. Idempotent and safe to re-run.
 *
 * Needed once after deploying the `rowCount` field — write paths
 * self-heal on first hit, but datasets that haven't been written to
 * since the field landed keep showing the preview-length fallback
 * (capped at PREVIEW_ROW_COUNT). Running this promotes every doc to
 * the fast path in one shot.
 *
 * Cost is O(total rows). Run from the convex CLI:
 *   npx convex run datasets:backfillRowCounts
 */
export const backfillRowCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const datasets = await ctx.db.query("datasets").collect();
    let patched = 0;
    let alreadyCorrect = 0;
    for (const ds of datasets) {
      const rows = await ctx.db
        .query("datasetRows")
        .withIndex("by_dataset", (q) => q.eq("datasetId", ds._id))
        .collect();
      if (ds.rowCount === rows.length) {
        alreadyCorrect++;
        continue;
      }
      await ctx.db.patch(ds._id, { rowCount: rows.length });
      patched++;
    }
    return { patched, alreadyCorrect, total: datasets.length };
  },
});
