import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  datasets: defineTable({
    name: v.string(),
    description: v.string(),
    ownerId: v.string(),
    status: v.union(
      v.literal("live"),
      v.literal("paused"),
      v.literal("building"),
      v.literal("updating"),
      v.literal("failed")
    ),
    lastStatusError: v.optional(v.string()),
    // Legacy rollout field. Existing documents may still contain this
    // display-only label; new code reads/writes refreshCadence instead.
    cadence: v.optional(v.string()),
    refreshCadence: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("30m"),
        v.literal("6h"),
        v.literal("12h"),
        v.literal("daily"),
        v.literal("weekly")
      )
    ),
    refreshEnabled: v.optional(v.boolean()),
    nextRefreshAt: v.optional(v.number()),
    lastRefreshAt: v.optional(v.number()),
    lastRefreshStartedAt: v.optional(v.number()),
    lastRefreshRunId: v.optional(v.string()),
    // Optional for backward compat with rows seeded before this field existed.
    // Treat undefined as "private" in authorization helpers.
    visibility: v.optional(
      v.union(v.literal("public"), v.literal("private"))
    ),
    // Stable identifier for system-managed/curated datasets so dedup at seed
    // time doesn't rely on `name` (which marketing changes). User-created
    // datasets do not set this. See convex/publicSeed.ts.
    seedKey: v.optional(v.string()),
    // Denormalized row count maintained by `datasetRows.insert / remove /
    // clearByDataset` and by the seed/create paths. Read by the dashboard
    // card's "X rows" footer via `datasets.attachPreview` so the count
    // stays reactive past the first PREVIEW_ROW_COUNT inserts (a query
    // over `.take(5)` only invalidates when one of the first 5 rows
    // changes, freezing the dashboard at 5). Optional for backward compat
    // with rows created before this field existed — write paths self-heal
    // on first hit, and `datasets.backfillRowCounts` migrates all at once.
    rowCount: v.optional(v.number()),
    // User-selected target/limit for populate runs. Optional so existing
    // datasets keep the legacy 100-row behavior until touched.
    maxRowCount: v.optional(v.number()),
    columns: v.array(
      v.object({
        name: v.string(),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("boolean"),
          v.literal("url"),
          v.literal("date")
        ),
        description: v.optional(v.string()),
        isPrimaryKey: v.optional(v.boolean()),
      })
    ),
    retrievalStrategy: v.optional(
      v.union(
        v.literal("search_fetch"),
        v.literal("browser"),
        v.literal("hybrid")
      )
    ),
    sourceHint: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_visibility", ["visibility"])
    .index("by_seed_key", ["seedKey"])
    .index("by_refresh_due", ["refreshEnabled", "nextRefreshAt"]),

  datasetRows: defineTable({
    datasetId: v.id("datasets"),
    data: v.record(v.string(), v.any()),
    sources: v.optional(v.array(v.string())),
    rowSummary: v.optional(v.string()),
    howFound: v.optional(v.string()),
    updateStatus: v.optional(v.literal("pending")),
    scrapeScript: v.optional(v.string()),
  })
    .index("by_dataset", ["datasetId"])
    // Compound index used by clearAllPendingUpdateStatus to scan only the rows
    // that need clearing without a full-dataset read.
    .index("by_dataset_update_status", ["datasetId", "updateStatus"]),

  datasetHistory: defineTable({
    datasetRowId: v.id("datasetRows"),
    columnName: v.string(),
    oldValue: v.string(),
    newValue: v.string(),
    changedAt: v.number(),
  }).index("by_row", ["datasetRowId"]),

  // Per-user / per-account quota accounting. One row per principal, created
  // lazily on first row modification. `rowsConsumed` tracks WORK done in
  // the current period — deleting rows does NOT refund quota.
  //
  // Period model: calendar month, UTC. Rolls over on the 1st (UTC) of each
  // month — the helper detects rollover lazily on the next read/write and
  // resets the counter without a background job.
  //
  // The `userId` field is named for the current scope (per-Clerk-user) but
  // semantically holds any principal id — when Clerk Organizations land,
  // an `org_xxx` id will live here too without a schema change. See
  // convex/lib/quota.ts for the resolution policy.
  //
  // Future fields (all optional → no migration needed when added):
  //   - plan: "free" | "pro" | "enterprise" (today: implicitly "free")
  //   - limitOverride (admin grants beyond plan default)
  usage: defineTable({
    userId: v.string(),
    rowsConsumed: v.number(),
    periodStart: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  openRouterModels: defineTable({
    modelName: v.string(),
    canonicalSlug: v.string(),
    contextLength: v.number(),
    completionCost: v.number(),
    promptCost: v.number(),
  }).index("by_slug", ["canonicalSlug"]),

  modelConfig: defineTable({
    userId: v.string(),
    schemaInference: v.optional(v.string()),
    populateOrchestrator: v.optional(v.string()),
    investigateSubagent: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  localCredentials: defineTable({
    service: v.union(v.literal("tinyfish"), v.literal("openrouter")),
    keychainAccount: v.optional(v.string()),
    connectionMethod: v.union(v.literal("api_key"), v.literal("oauth")),
    verifiedAt: v.number(),
    updatedAt: v.number(),
    // Legacy only: accepted so the migration can deploy, then cleared by the
    // backend startup purge. New code never writes this field.
    apiKey: v.optional(v.string()),
  }).index("by_service", ["service"]),

  // One row per populate workflow run. Written once at the end of each run
  // (success or error) by the backend agent runner — never by the frontend.
  // Tracks tool-call counts, token usage, and timing so runs can be
  // compared across datasets, users, and benchmark sessions.
  runStats: defineTable({
    workflowRunId: v.string(),
    datasetId: v.string(),
    userId: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    durationMs: v.number(),
    searchCalls: v.number(),
    fetchCalls: v.number(),
    investigateCalls: v.number(),
    rowsInserted: v.number(),
    tokensInput: v.number(),
    tokensOutput: v.number(),
    orchestratorTokensInput: v.number(),
    orchestratorTokensOutput: v.number(),
    orchestratorSteps: v.number(),
    investigateTokensInput: v.number(),
    investigateTokensOutput: v.number(),
    investigateSteps: v.number(),
    investigateRuns: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
    error: v.optional(v.string()),
    isBenchmark: v.optional(v.boolean()),
    workflowType: v.optional(
      v.union(v.literal("populate"), v.literal("update"))
    ),
    rowsUpdated: v.optional(v.number()),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_user", ["userId"])
    .index("by_workflow_run", ["workflowRunId"]),

  // API keys for non-browser clients (Google Sheets add-on, CLI, etc.).
  // We never store the plaintext key — only a SHA-256 hash. The `keyPrefix`
  // (first 8 chars) is returned in listings so users can identify a key
  // without leaking the secret. Created by the backend, listed/revoked
  // through HTTP routes under requireAuth.
  apiKeys: defineTable({
    ownerId: v.string(),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_hash", ["keyHash"]),

  /**
   * Tracks individual data enrichment runs initiated by the Google Sheets addon.
   * Each run fills empty columns in existing rows using AI-powered research.
   */
  sheetsEnrichmentRuns: defineTable({
    datasetId: v.id("datasets"),
    userId: v.string(),
    sourceColumns: v.array(v.string()),
    targetColumns: v.array(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped")
    ),
    rowsProcessed: v.number(),
    rowsUpdated: v.number(),
    rowsFound: v.number(),
    errors: v.array(
      v.object({
        rowId: v.string(),
        message: v.string(),
      })
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    workflowRunId: v.optional(v.string()),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_user", ["userId"])
    .index("by_workflow_run", ["workflowRunId"]),
});
