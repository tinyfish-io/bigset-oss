import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "./env.js";
import { convex, internal } from "./convex.js";
import { LOCAL_USER_ID } from "./local-credentials.js";

const KEY_PREFIX_LEN = 8;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const random = randomBytes(32).toString("base64url");
  const key = `bsk_${random}`;
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, KEY_PREFIX_LEN);
  return { key, keyHash, keyPrefix };
}

export function apiKeyHash(key: string): string {
  return hashKey(key);
}

export async function requireApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const header = req.headers["x-api-key"];
  const authHeader = req.headers.authorization;
  let rawKey: string | undefined;
  if (typeof header === "string" && header.startsWith("bsk_")) {
    rawKey = header;
  } else if (typeof authHeader === "string" && authHeader.startsWith("Bearer bsk_")) {
    rawKey = authHeader.slice("Bearer ".length);
  }
  if (!rawKey) return false;

  const keyHash = hashKey(rawKey);
  const record = await convex.query(internal.apiKeys.lookupByHash, { keyHash });
  if (!record) {
    await reply.code(401).send({ error: "Invalid API key" });
    return true;
  }

  req.auth = { userId: record.ownerId };

  void convex
    .mutation(internal.apiKeys.touchLastUsed, {
      id: record._id,
      lastUsedAt: Date.now(),
    })
    .catch(() => {});

  return true;
}

/**
 * Try API-key auth. Returns:
 *   - `true`  if the request had an X-API-Key / Bearer bsk_… header
 *     (either the key was accepted and req.auth is set, or the response
 *     was already sent with 401). Caller must NOT continue.
 *   - `false` if no API key was presented. Caller should fall through
 *     to Clerk (or whatever its next auth mechanism is).
 */
export async function tryApiKeyAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const header = req.headers["x-api-key"];
  const authHeader = req.headers.authorization;
  const hasKey =
    (typeof header === "string" && header.startsWith("bsk_")) ||
    (typeof authHeader === "string" && authHeader.startsWith("Bearer bsk_"));
  if (!hasKey) return false;
  await requireApiKey(req, reply);
  return true;
}

export async function requireApiKeyOrCli(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (env.IS_LOCAL_MODE) {
    req.auth = { userId: LOCAL_USER_ID };
    return true;
  }
  return requireApiKey(req, reply);
}
