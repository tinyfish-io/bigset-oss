import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { loadOwnedDataset, requireIdentity } from "./lib/authz.js";

/**
 * Creates a new enrichment run tracking record.
 * Called when the user starts an enrichment operation from the Sheets addon.
 */
export const create = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    userId: v.string(),
    sourceColumns: v.array(v.string()),
    targetColumns: v.array(v.string()),
    workflowRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sheetsEnrichmentRuns", {
      datasetId: args.datasetId,
      userId: args.userId,
      sourceColumns: args.sourceColumns,
      targetColumns: args.targetColumns,
      status: "running",
      rowsProcessed: 0,
      rowsUpdated: 0,
      rowsFound: 0,
      errors: [],
      startedAt: Date.now(),
      workflowRunId: args.workflowRunId,
    });
  },
});

/**
 * Update enrichment run progress.
 * Called by the enrichment workflow as rows are processed.
 */
export const updateProgress = internalMutation({
  args: {
    id: v.id("sheetsEnrichmentRuns"),
    rowsProcessed: v.number(),
    rowsUpdated: v.number(),
    rowsFound: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run || run.status !== "running") return;

    await ctx.db.patch(args.id, {
      rowsProcessed: args.rowsProcessed,
      rowsUpdated: args.rowsUpdated,
      rowsFound: args.rowsFound,
    });
  },
});

/**
 * Record an error for a specific row during enrichment.
 */
export const addError = internalMutation({
  args: {
    id: v.id("sheetsEnrichmentRuns"),
    rowId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run || run.status !== "running") return;

    const errors = [...run.errors, { rowId: args.rowId, message: args.message }];
    await ctx.db.patch(args.id, { errors });
  },
});

/**
 * Mark enrichment run as completed.
 */
export const complete = internalMutation({
  args: {
    id: v.id("sheetsEnrichmentRuns"),
    rowsProcessed: v.number(),
    rowsUpdated: v.number(),
    rowsFound: v.number(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      rowsProcessed: args.rowsProcessed,
      rowsUpdated: args.rowsUpdated,
      rowsFound: args.rowsFound,
      completedAt: Date.now(),
    });
  },
});

/**
 * Get enrichment run by ID.
 */
export const get = internalQuery({
  args: { id: v.id("sheetsEnrichmentRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get enrichment runs for a dataset.
 */
export const listByDataset = internalQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sheetsEnrichmentRuns")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .order("desc")
      .collect();
  },
});

/**
 * User-facing: list enrichment runs for datasets owned by the authenticated user.
 */
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    return await ctx.db
      .query("sheetsEnrichmentRuns")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(50);
  },
});

/**
 * Get the most recent running enrichment run for a dataset, if any.
 */
export const getActiveRunForDataset = internalQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("sheetsEnrichmentRuns")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();

    return runs.find((r) => r.status === "running") ?? null;
  },
});
