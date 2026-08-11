import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import { createClerkClient, type ClerkClient } from "@clerk/backend";

import { env } from "./env.js";
import { LOCAL_USER_ID } from "./local-credentials.js";

/**
 * Clerk JWT verification for the Fastify backend.
 *
 * Design:
 *   - The backend is the agent runner. It primarily talks to Convex via the
 *     admin key for SYSTEM operations (see ./convex.ts).
 *   - Any HTTP endpoint that accepts a request *from a user* (frontend or
 *     external) MUST be gated by the `requireAuth` preHandler exported here.
 *     This verifies the bearer token against Clerk's JWKS and attaches the
 *     authenticated identity to the request.
 *   - Public endpoints (e.g. /health) skip the preHandler.
 *
 * Pattern for protected routes — see index.ts:
 *
 *   fastify.register(async (instance) => {
 *     instance.addHook("preHandler", requireAuth);
 *     instance.get("/me", async (req) => req.auth);
 *   });
 *
 * NEVER trust user-supplied `userId` in request bodies. Use req.auth.userId.
 */

declare module "fastify" {
  interface FastifyRequest {
    auth?: { userId: string };
  }
  interface FastifyInstance {
    clerk: ClerkClient;
  }
}

const clerkPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  if (env.IS_PROD && !env.CLERK_SECRET_KEY) {
    fastify.log.warn(
      "CLERK_SECRET_KEY not set — protected routes will reject all requests. " +
        "Set it before adding routes that require auth.",
    );
  }

  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY ?? "",
    publishableKey: env.CLERK_PUBLISHABLE_KEY ?? "",
  });
  fastify.decorate("clerk", clerk);
};

/**
 * Resolve a user's primary email address by Clerk user id.
 *
 * Returns `null` if the user has no primary email (phone-only auth, rare
 * config) or if Clerk's API errors. Callers should treat `null` as
 * "skip the email" — never throw, since email is always best-effort.
 */
export async function getUserEmail(
  clerk: ClerkClient,
  userId: string,
): Promise<string | null> {
  if (env.IS_LOCAL_MODE) return null;
  try {
    const user = await clerk.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export default fp(clerkPlugin, { name: "clerk-auth" });

/**
 * Fastify preHandler that requires a valid Clerk session token.
 *
 * Reads `Authorization: Bearer <token>`, verifies it via Clerk's
 * `authenticateRequest`, and attaches `req.auth = { userId }` on success.
 * Returns 401 otherwise.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (env.IS_LOCAL_MODE) {
    req.auth = { userId: LOCAL_USER_ID };
    return;
  }

  if (!env.CLERK_SECRET_KEY) {
    req.log.error("CLERK_SECRET_KEY is not set; cannot verify request");
    await reply.code(500).send({ error: "Auth not configured" });
    return;
  }

  // Wrap the Fastify request just enough for Clerk's authenticateRequest API.
  // Clerk accepts a Web Request; build one from the headers we care about.
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }

  const clerkRequest = new Request(
    `http://internal${req.url}`,
    { method: req.method, headers },
  );

  const requestState = await req.server.clerk.authenticateRequest(
    clerkRequest,
    {
      // Anyone consuming our backend is our own frontend; lock to allowed origins.
      authorizedParties: env.CLIENT_ORIGINS,
    },
  );

  if (!requestState.isAuthenticated) {
    await reply.code(401).send({ error: "Unauthenticated" });
    return;
  }

  const auth = requestState.toAuth();
  if (!auth.userId) {
    await reply.code(401).send({ error: "Unauthenticated" });
    return;
  }

  req.auth = { userId: auth.userId };
}
