import {
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
import { v } from "convex/values";

export const create = internalMutation({
  args: {
    ownerId: v.string(),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("apiKeys", args);
    return { id };
  },
});

export const revoke = internalMutation({
  args: {
    id: v.id("apiKeys"),
    ownerId: v.string(),
    revokedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.ownerId !== args.ownerId) return null;
    await ctx.db.patch(args.id, { revokedAt: args.revokedAt });
    return { success: true };
  },
});

export const listByOwner = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
  },
});

export const lookupByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const matches = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", keyHash))
      .collect();
    return matches.find((k) => !k.revokedAt) ?? null;
  },
});

export const touchLastUsed = internalMutation({
  args: {
    id: v.id("apiKeys"),
    lastUsedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastUsedAt: args.lastUsedAt });
  },
});
