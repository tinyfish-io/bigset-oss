# BigSet

Monorepo: `frontend/` (Next.js 16) + `backend/` (Fastify + Mastra). Run with `make dev` (Docker).

Frontend on :3500, backend on :3501, Mastra Studio on :4111, Convex dashboard on :6791.

## Setup

1. `make dev` auto-creates a local `.env` on first run (no template to copy). Fill in your keys there:
   - `TINYFISH_API_KEY` — from https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2
   - `OPENROUTER_API_KEY` — from https://openrouter.ai/settings/keys
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from Clerk API Keys
   - `CLERK_SECRET_KEY` — from Clerk API Keys
   - `CLERK_JWT_ISSUER_DOMAIN` — your Frontend API URL (e.g. `https://your-app.clerk.accounts.dev`)
2. Create a free Clerk account at https://clerk.com and create an application.
3. In the Clerk dashboard, go to **JWT Templates** and enable the **Convex** template.
4. Run `make dev` — starts all Docker services, auto-generates the Convex admin key on first run, and pushes Convex functions. No manual key generation needed.

## Architecture

Auth is Clerk. Frontend uses `@clerk/nextjs` with `ClerkProvider` wrapping the app. Convex validates Clerk JWTs via `convex/auth.config.ts`. Protected routes enforced by Clerk proxy (`frontend/proxy.ts`). No self-hosted auth database.

Dataset storage uses Convex (self-hosted at :3210). Schema in `frontend/convex/schema.ts`, functions in `frontend/convex/datasets.ts` and `frontend/convex/datasetRows.ts`. Convex dashboard at :6791.

Frontend uses Convex React hooks (`useQuery`, `useMutation`) with `ConvexProviderWithClerk` for authenticated realtime queries. Use `useConvexAuth()` (not Clerk's `useAuth()`) to check auth state in components. For backend calls, the frontend uses `useAuth().getToken()` from `@clerk/nextjs` to get a Bearer token and passes it to the API client in `frontend/lib/backend.ts`.

Backend is Fastify + Mastra. Fastify serves the HTTP API (Clerk JWT auth on protected routes via `backend/src/clerk-auth.ts`). Mastra (`backend/src/mastra/`) is the workflow orchestration layer — it wraps pipelines into inspectable workflows with a Studio UI. Both run as separate Docker services sharing the same source code.

The schema inference pipeline: frontend calls `POST /infer-schema` → Fastify verifies the Clerk JWT → calls `inferSchema()` in `backend/src/pipeline/schema-inference.ts` → Claude Sonnet 4.6 via OpenRouter → returns a Zod-validated `DatasetSchema` → frontend maps it to editable columns in the wizard.

The populate pipeline: frontend calls `POST /populate` with `{ datasetId, datasetName, description, columns }` → Fastify verifies the Clerk JWT → triggers `populateWorkflow` which: (1) clears existing rows, (2) builds a prompt from the schema, (3) runs the populate agent (Claude Sonnet 4.6) which searches the web via TinyFish APIs, then inserts rows into Convex one by one. Rows appear in realtime on the frontend via Convex reactive queries.

Convex functions use `ctx.auth.getUserIdentity()` to get the authenticated user. The `ownerId` field on datasets stores `identity.subject` (Clerk user ID). Do not pass `ownerId` from the client.

## Environment Variables

Root `.env` is the only local env file. Docker Compose, package scripts, and Convex CLI helper targets all read it. Key variables:
- `TINYFISH_API_KEY` — used by the populate agent for web search and fetch (get one at https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2)
- `OPENROUTER_API_KEY` — used by backend and Mastra for AI model calls
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — shared by frontend and backend
- `CONVEX_SELF_HOSTED_ADMIN_KEY` — used by backend for system-level Convex writes

The backend container maps `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → `CLERK_PUBLISHABLE_KEY` (see `docker-compose.dev.yml`).

## Convex Deploys

Convex is self-hosted — it does NOT hot-reload when you edit files in `frontend/convex/`. After changing any Convex function, schema, or auth config, you must run `make convex-push` to deploy the updated code to the running instance. `make dev` does this automatically on startup, but subsequent edits require a manual push.

In CI/prod, run `npx convex deploy` with `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` set as env vars.

This is an open-source (AGPL) project. Do not commit secrets, API keys, or internal docs.
