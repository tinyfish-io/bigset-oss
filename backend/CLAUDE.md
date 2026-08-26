# Backend

Fastify + TypeScript + ESM (`"type": "module"` — use `.js` extensions in imports).

## HTTP API (Fastify)

Fastify serves the backend API on :3501. Protected routes use Clerk JWT verification via the `requireAuth` preHandler in `src/clerk-auth.ts`. The frontend passes a Bearer token (from `@clerk/nextjs` `getToken()`) on every request.

Routes:
- `GET /health` — public health check
- `POST /infer-schema` — protected. Accepts `{ prompt: string }`, returns a `DatasetSchema`. Calls `inferSchema()` from the pipeline.
- `POST /populate` — protected. Accepts a `DatasetContext` (datasetId, name, description, columns). Triggers the populate workflow which clears existing rows, then uses an AI agent to search the web and insert real data.

To add a new protected route, register it inside the scoped plugin in `src/index.ts` that has `requireAuth` as a preHandler. Use `req.auth.userId` for the authenticated user — never trust user-supplied IDs in the body.

## Schema Inference Pipeline

`src/pipeline/schema-inference.ts` — takes a natural language prompt and returns a structured `DatasetSchema` (Zod-validated, defined in `src/pipeline/types.ts`). Uses Claude Sonnet 4.6 via OpenRouter (`@openrouter/ai-sdk-provider` + Vercel AI SDK). Auto-retries once on validation failure by feeding the error back to the model.

The pipeline is a pure function (`inferSchema(prompt) → DatasetSchema`). It is called by both Fastify (for the HTTP API) and Mastra (for workflow orchestration).

## Mastra (Workflow Orchestration)

`src/mastra/` — wraps pipelines into Mastra workflows. Runs as a separate Docker service on :4111 with `mastra dev`, which provides a Studio UI for inspecting and testing workflows.

- `src/mastra/index.ts` — registers workflows with the `Mastra` instance (the populate agent is built per-run, not registered as a singleton)
- `src/mastra/workflows/infer-schema.ts` — `inferSchemaWorkflow`, a single-step workflow wrapping `inferSchema()`
- `src/mastra/workflows/populate.ts` — `populateWorkflow`, 3-step workflow: clear rows → build prompt → run populate agent
- `src/mastra/agents/populate.ts` — `buildPopulateAgent(authorizedDatasetId, authContext, columns)`, builds the orchestrator agent (Claude Sonnet 4.6) with 3 tools: `search_web`, `fetch_page`, `investigate_row`. No write access — all inserts go through investigate subagents.
- `src/mastra/agents/investigate.ts` — `buildInvestigateAgent(authorizedDatasetId, authContext, columns)`, builds a per-entity subagent with `insert_row`, `list_rows`, `search_web`, `fetch_page`. Researches one entity, inserts at most one row, returns structured feedback (`INSERTED/SUMMARY/CLUES/REASON`).
- `src/mastra/tools/investigate-tool.ts` — `buildInvestigateTool(authorizedDatasetId, authContext, columns)` creates the `investigate_row` tool. The orchestrator calls it to hand off a lead; it spawns a fresh investigate agent, runs it (maxSteps: 25), parses the structured output, and returns it to the orchestrator. Errors are caught and returned as structured failures so the orchestrator can self-correct.
- `src/mastra/tools/dataset-tools.ts` — `buildPopulateTools(authorizedDatasetId, authContext)` factory returning 5 Convex-backed tools: `insert_row`, `list_rows`, `get_row`, `update_row`, `delete_row`. The dataset id is captured by closure so the LLM cannot redirect writes to other datasets; `authContext` (Clerk userId + workflow run id) is captured for caller-attribution in security logs and the `CAPABILITY_VIOLATION` PostHog event. See the security note at the top of the file.
- `src/mastra/tools/web-tools.ts` — 2 TinyFish API tools: `search_web`, `fetch_page`

The populate workflow builds a fresh orchestrator per run via `buildPopulateAgent(...)` and calls `.generate(prompt, { maxSteps: 80 })`. The orchestrator spawns up to 3 investigate subagents in parallel via `investigate_row`. Per-run construction is required by the capability-scoping security model (closure-bound dataset id); do not cache or share agents across runs.

All tools return structured error messages (not thrown exceptions) so the agent can self-correct.

Mastra uses `HOST` and `PORT` env vars for binding. In Docker, `HOST=0.0.0.0` is required.

## Convex

Writes to Convex via `ConvexHttpClient` in `src/convex.ts`. Import `{ convex, api, internal }` from `./convex.js` to call Convex mutations and queries. Uses `anyApi` from `convex/server` as an untyped proxy — this avoids cross-project imports from the frontend's generated code, which don't work in Docker containers. Admin key is set via `setAdminAuth()` for internal mutations.

## Environment

Required env vars (loaded from the root `.env`; see `src/env.ts`):
- `CONVEX_URL` — Convex instance URL
- `CONVEX_SELF_HOSTED_ADMIN_KEY` — for system-level Convex writes (internal mutations)
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` — for JWT verification
- `OPENROUTER_API_KEY` — for AI model calls
- `TINYFISH_API_KEY` — for web search and fetch (populate agent). Get one at https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2

In Docker, these are interpolated from the root `.env` file via `docker-compose.dev.yml`.
