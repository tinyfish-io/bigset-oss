# BigSet Backend

Fastify server that handles auth, database, and talks to TinyFish APIs.
LLM calls are routed through an OpenAI-compatible gateway — OpenRouter by
default, or [OrcaRouter](https://www.orcarouter.ai) when an OrcaRouter key
is configured (or `LLM_PROVIDER=orcarouter` is set in the root `.env`).

## Running

```bash
# From the repo root:
cp .env.example .env
# Fill in the root .env file.
cd backend
npm install
npm run dev
```

Starts on [localhost:3501](http://localhost:3501).

## Key Paths

- `src/index.ts` — Fastify server + route setup
- `src/clerk-auth.ts` — Clerk JWT verification
- `src/convex.ts` — Convex HTTP client
- `src/env.ts` — root env loader

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |

Local backend scripts load the repo-root `.env` through `../scripts/with-root-env.mjs`.
