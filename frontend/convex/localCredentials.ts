import { internalMutation, internalQuery } from "./_generated/server.js";
import { v } from "convex/values";
import {
  LLM_PROVIDER_TYPES,
  LOCAL_CREDENTIAL_SERVICES,
} from "../lib/llm-provider-types.js";

const serviceValidator = v.union(
  ...LOCAL_CREDENTIAL_SERVICES.map((service) => v.literal(service)),
);

const connectionMethodValidator = v.union(
  v.literal("api_key"),
  v.literal("oauth"),
);

const llmProviderValidator = v.union(
  ...LLM_PROVIDER_TYPES.map((provider) => v.literal(provider)),
);

export const getInternal = internalQuery({
  args: { service: serviceValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("localCredentials")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .unique();
  },
});

export const upsertInternal = internalMutation({
  args: {
    service: serviceValidator,
    keychainAccount: v.optional(v.string()),
    connectionMethod: connectionMethodValidator,
    verifiedAt: v.number(),
    llmProvider: v.optional(llmProviderValidator),
    llmBaseUrl: v.optional(v.string()),
    llmDefaultModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("localCredentials")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .unique();

    const update = {
      ...(args.keychainAccount !== undefined
        ? { keychainAccount: args.keychainAccount }
        : {}),
      connectionMethod: args.connectionMethod,
      verifiedAt: args.verifiedAt,
      updatedAt: Date.now(),
    };
    const providerChanged =
      args.llmProvider !== undefined &&
      args.llmProvider !== existing?.llmProvider;
    const llmPatch =
      args.llmProvider !== undefined
        ? {
            llmProvider: args.llmProvider,
            ...(providerChanged
              ? {
                  // Clear provider-scoped values when switching providers.
                  llmBaseUrl: args.llmBaseUrl,
                  llmDefaultModel: args.llmDefaultModel,
                }
              : {
                  ...(args.llmBaseUrl !== undefined
                    ? { llmBaseUrl: args.llmBaseUrl }
                    : {}),
                  ...(args.llmDefaultModel !== undefined
                    ? { llmDefaultModel: args.llmDefaultModel }
                    : {}),
                }),
          }
        : {};
    const llmInsert = args.llmProvider !== undefined
      ? {
          llmProvider: args.llmProvider,
          ...(args.llmBaseUrl !== undefined ? { llmBaseUrl: args.llmBaseUrl } : {}),
          ...(args.llmDefaultModel !== undefined ? { llmDefaultModel: args.llmDefaultModel } : {}),
        }
      : {};

    if (existing) {
      await ctx.db.patch(existing._id, { ...update, ...llmPatch, apiKey: undefined });
      return existing._id;
    }

    return await ctx.db.insert("localCredentials", {
      service: args.service,
      ...update,
      ...llmInsert,
    });
  },
});

export const clearLegacyPlaintextInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("localCredentials").collect();
    let cleared = 0;

    for (const row of rows) {
      if (row.apiKey !== undefined) {
        await ctx.db.patch(row._id, { apiKey: undefined });
        cleared += 1;
      }
    }

    return { cleared };
  },
});
