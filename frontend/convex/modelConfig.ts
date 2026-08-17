import { query, mutation, internalQuery, internalMutation } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { v } from "convex/values";
import { getIdentity } from "./lib/authz.js";
import {
  LLM_PROVIDER_TYPES,
  type LlmProviderType,
} from "../lib/llm-provider-types.js";

const providerValidator = v.union(
  ...LLM_PROVIDER_TYPES.map((provider) => v.literal(provider)),
);

async function findProviderConfig(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  provider: LlmProviderType,
) {
  const providerRow = await ctx.db
    .query("modelConfig")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", userId).eq("provider", provider),
    )
    .first();

  if (providerRow) return providerRow;

  if (provider === "openrouter") {
    return await ctx.db
      .query("modelConfig")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("provider"), undefined))
      .first();
  }

  return null;
}

export const get = query({
  args: { provider: v.optional(providerValidator) },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx);
    if (!identity) return null;

    return await findProviderConfig(
      ctx,
      identity.subject,
      args.provider ?? "openrouter",
    );
  },
});

/**
 * Upsert one or more model preferences for the authenticated user and provider.
 *
 * Only fields that are explicitly provided (not undefined) are updated.
 * Unset fields retain their existing database values.
 */
export const upsert = mutation({
  args: {
    provider: v.optional(providerValidator),
    schemaInference: v.optional(v.string()),
    populateOrchestrator: v.optional(v.string()),
    investigateSubagent: v.optional(v.string()),
    // null clears the override (back to auto); undefined leaves it untouched.
    schemaInferenceReasoning: v.optional(v.union(v.string(), v.null())),
    populateOrchestratorReasoning: v.optional(v.union(v.string(), v.null())),
    investigateSubagentReasoning: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await getIdentity(ctx);
    if (!identity) throw new Error("Not authenticated");

    const provider = args.provider ?? "openrouter";
    const existing = await findProviderConfig(ctx, identity.subject, provider);

    const patch: {
      provider?: LlmProviderType;
      schemaInference?: string;
      populateOrchestrator?: string;
      investigateSubagent?: string;
      schemaInferenceReasoning?: string | undefined;
      populateOrchestratorReasoning?: string | undefined;
      investigateSubagentReasoning?: string | undefined;
    } = { provider };
    if (args.schemaInference !== undefined) patch.schemaInference = args.schemaInference;
    if (args.populateOrchestrator !== undefined) patch.populateOrchestrator = args.populateOrchestrator;
    if (args.investigateSubagent !== undefined) patch.investigateSubagent = args.investigateSubagent;
    // `null` is a request to clear: patching the field to undefined removes it.
    if (args.schemaInferenceReasoning !== undefined)
      patch.schemaInferenceReasoning = args.schemaInferenceReasoning ?? undefined;
    if (args.populateOrchestratorReasoning !== undefined)
      patch.populateOrchestratorReasoning = args.populateOrchestratorReasoning ?? undefined;
    if (args.investigateSubagentReasoning !== undefined)
      patch.investigateSubagentReasoning = args.investigateSubagentReasoning ?? undefined;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("modelConfig", {
        userId: identity.subject,
        ...patch,
      });
    }
  },
});

export const getInternal = internalQuery({
  args: { userId: v.string(), provider: v.optional(providerValidator) },
  handler: async (ctx, args) => {
    return await findProviderConfig(
      ctx,
      args.userId,
      args.provider ?? "openrouter",
    );
  },
});

/**
 * Upsert model preferences for a specific user/provider (internal, backend-only).
 *
 * Only fields that are explicitly provided (not undefined) are updated.
 */
export const upsertInternal = internalMutation({
  args: {
    userId: v.string(),
    provider: v.optional(providerValidator),
    schemaInference: v.optional(v.string()),
    populateOrchestrator: v.optional(v.string()),
    investigateSubagent: v.optional(v.string()),
    // null clears the override (back to auto); undefined leaves it untouched.
    schemaInferenceReasoning: v.optional(v.union(v.string(), v.null())),
    populateOrchestratorReasoning: v.optional(v.union(v.string(), v.null())),
    investigateSubagentReasoning: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? "openrouter";
    const existing = await findProviderConfig(ctx, args.userId, provider);

    const patch: {
      provider: LlmProviderType;
      schemaInference?: string;
      populateOrchestrator?: string;
      investigateSubagent?: string;
      schemaInferenceReasoning?: string | undefined;
      populateOrchestratorReasoning?: string | undefined;
      investigateSubagentReasoning?: string | undefined;
    } = { provider };
    if (args.schemaInference !== undefined) patch.schemaInference = args.schemaInference;
    if (args.populateOrchestrator !== undefined) patch.populateOrchestrator = args.populateOrchestrator;
    if (args.investigateSubagent !== undefined) patch.investigateSubagent = args.investigateSubagent;
    // `null` is a request to clear: patching the field to undefined removes it.
    if (args.schemaInferenceReasoning !== undefined)
      patch.schemaInferenceReasoning = args.schemaInferenceReasoning ?? undefined;
    if (args.populateOrchestratorReasoning !== undefined)
      patch.populateOrchestratorReasoning = args.populateOrchestratorReasoning ?? undefined;
    if (args.investigateSubagentReasoning !== undefined)
      patch.investigateSubagentReasoning = args.investigateSubagentReasoning ?? undefined;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("modelConfig", {
        userId: args.userId,
        ...patch,
      });
    }
  },
});
