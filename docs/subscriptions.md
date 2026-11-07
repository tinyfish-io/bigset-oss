# Run BigSet on your Claude or ChatGPT subscription

BigSet's models can run through your own paid plan instead of an OpenRouter
API key:

| Plan | CLI BigSet drives | Sign in once |
|------|-------------------|--------------|
| Claude Pro / Max | [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`) | `claude auth login` |
| ChatGPT Plus / Pro / Business | [Codex](https://developers.openai.com/codex/cli) (`codex`) | `codex login` |

No OpenRouter account, no per-token bill. Usage counts against your plan's
limits instead.

## Setup

1. Install the CLI and sign in (table above).
2. Start BigSet (`bigset`, or `make dev` from source).
3. On the setup screen, add your TinyFish key. The **Or use your
   subscription** card shows each CLI it found. Click **Check again** after
   signing in. TinyFish plus one signed-in CLI completes setup.

When no OpenRouter key is configured, BigSet picks defaults automatically:

| Role | Claude subscription | ChatGPT subscription |
|------|---------------------|----------------------|
| Schema inference | `claude-code/sonnet` | Codex's default for your plan (today `gpt-6.1-sol`) |
| Populate orchestrator | `claude-code/sonnet` | same |
| Investigate subagents | `claude-code/haiku` | same |

Change any of them under **Settings → Models**. Subscription models are listed
first, with a cost of 0. The Codex list comes from Codex itself, so it always
matches what your plan offers.

### Which backend wins

1. `BIGSET_MODEL_BACKEND=openrouter|claude-code|codex` in `.env` forces one.
2. Otherwise, an OpenRouter key if one is configured (existing setups keep
   working unchanged).
3. Then a signed-in Claude Code CLI.
4. Then a signed-in Codex CLI.

Models a user picked in settings always win over these defaults.

## How it works

Model slugs carry the backend: `claude-code/<model>` and `codex/<model>` run on
the subscription, and any other slug (e.g. `anthropic/claude-sonnet-4.6`) runs
on OpenRouter. `backend/src/ai/language-model.ts` is the only place that turns
a slug into a model.

Each CLI runs its own agent loop. BigSet passes its tools (`search_web`,
`fetch_page`, `insert_row`, `update_row`, `run_subagent`) to the CLI through
an MCP server that lives inside the BigSet backend. The tool code runs in the
backend with the same dataset scoping as the OpenRouter path. The CLIs' own
tools are turned off:

- Claude Code: no built-in tools (`tools: []`), only `mcp__bigset__*` allowed,
  no user settings, CLAUDE.md or hooks loaded, sessions not saved to your
  history.
- Codex: read-only sandbox, its own web search disabled
  (`web_search = "disabled"`). One `codex app-server` process is shared and
  stopped when the backend shuts down.

Both run in an empty temporary directory so no project files leak in as
context.

BigSet uses the `claude` / `codex` on your `PATH` (override with
`CLAUDE_CODE_PATH` / `CODEX_PATH`). It skips `node_modules/.bin`, because the
copy bundled with the npm packages lags your install and rejects newer plan
models.

## Docker (`make dev`)

The backend container cannot see your Mac's keychain login.

- **Claude:** run `claude setup-token` on the host and put the token in `.env`
  as `CLAUDE_CODE_OAUTH_TOKEN`. The container then uses the Claude Code binary
  bundled with the npm package.
- **Codex:** not wired up for Docker. Use the native `bigset` install, or
  point `CODEX_PATH` at a Codex inside the container and mount `~/.codex`.

## Limits and caveats

- **Local mode only.** With `PROD=1` subscriptions report unavailable: a
  hosted BigSet would otherwise bill one person's plan for every user.
- **Plan limits.** A populate run fans out parallel subagents, and each one is
  a CLI turn. Large runs can hit your plan's usage window. Haiku as the
  subagent default helps on Claude.
- **Speed.** Each call starts a CLI turn: Claude Code takes about 2-5 s per
  call, Codex about 8-25 s.
- **Terms.** This drives the official CLIs on your own machine with your own
  login. Whether a plan allows this kind of automated use is up to the
  provider's terms. Check them if you plan heavy use.
- `maxOutputTokens` is ignored by both CLIs (the AI SDK logs a warning).
