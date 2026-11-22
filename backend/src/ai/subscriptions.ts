/**
 * Run BigSet's models on the user's own Claude or ChatGPT subscription.
 *
 * Instead of an OpenRouter API key, BigSet can drive the locally installed
 * Claude Code CLI (`claude`, signed in with a Claude Pro/Max plan) or the
 * Codex CLI (`codex`, signed in with a ChatGPT plan). Each CLI runs its own
 * agent loop, so BigSet's tools (search_web, fetch_page, insert_row, ...) are
 * handed to it as an in-process MCP server: the CLI decides when to call a
 * tool, and the tool's code still runs inside this backend process with the
 * same closure-scoped dataset authorization as the OpenRouter path.
 *
 * Built-in CLI tools (shell, file edits, the CLI's own web search) are turned
 * off or sandboxed read-only: the model only gets BigSet's tools.
 *
 * Local mode only. With PROD=1 one operator's personal plan would serve every
 * signed-in user, so subscriptions report unavailable and never get used.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { LanguageModelV3 as LanguageModel } from "@ai-sdk/provider";
import { tool as aiTool, type Tool } from "ai";
import { createAiSdkMcpServer, createClaudeCode } from "ai-sdk-provider-claude-code";
import {
  createCodexAppServer,
  createSdkMcpServer,
  tool as codexTool,
  type CodexAppServerProvider,
} from "ai-sdk-provider-codex-cli";
import type { ZodType } from "zod";
import { env } from "../env.js";

export type SubscriptionBackend = "claude-code" | "codex";

/** The MCP server name the CLIs see; tools appear as mcp__bigset__<name>. */
export const BIGSET_MCP_SERVER = "bigset";

/** Minimal shape of a Mastra `createTool` result that we bridge. */
export interface BridgeableTool {
  description?: string;
  inputSchema?: unknown;
  execute?: (input: any, context: any) => Promise<unknown>;
}

export type BridgeableTools = Record<string, BridgeableTool>;

export interface SubscriptionModelInfo {
  modelName: string;
  canonicalSlug: string;
  contextLength: number;
  completionCost: number;
  promptCost: number;
}

export interface RoleModelSlugs {
  schemaInference: string;
  populateOrchestrator: string;
  investigateSubagent: string;
}

function subscriptionModel(slug: string, name: string): SubscriptionModelInfo {
  // Costs are 0: usage is billed to the user's subscription, not per token.
  // contextLength 0 = unknown: neither CLI reports a context window, and
  // guessing one would be wrong for some plans (the picker shows "—").
  return { modelName: name, canonicalSlug: slug, contextLength: 0, promptCost: 0, completionCost: 0 };
}

// Claude Code resolves these aliases to the current Opus / Sonnet / Haiku.
const CLAUDE_CODE_MODELS = [
  subscriptionModel("claude-code/opus", "Claude Opus (Claude subscription)"),
  subscriptionModel("claude-code/sonnet", "Claude Sonnet (Claude subscription)"),
  subscriptionModel("claude-code/haiku", "Claude Haiku (Claude subscription)"),
];

const CLAUDE_CODE_DEFAULTS: RoleModelSlugs = {
  schemaInference: "claude-code/sonnet",
  populateOrchestrator: "claude-code/sonnet",
  // Subagents fan out in parallel; Haiku keeps subscription usage limits in reach.
  investigateSubagent: "claude-code/haiku",
};

const CODEX_MODELS_TTL_MS = 10 * 60_000;
let codexModelsCache: { at: number; models: SubscriptionModelInfo[]; defaultSlug: string | null } | null = null;

/**
 * Codex models differ per ChatGPT plan and change often, so ask the Codex
 * app-server instead of hardcoding a list. Cached for 10 minutes.
 */
async function codexModels(): Promise<{ models: SubscriptionModelInfo[]; defaultSlug: string | null }> {
  if (codexModelsCache && Date.now() - codexModelsCache.at < CODEX_MODELS_TTL_MS) return codexModelsCache;
  try {
    const listed = await codex().listModels();
    // Skip superseded models (Codex sets `upgrade` to their replacement).
    // The catalog still lists some the server already refuses for ChatGPT
    // sign-ins, e.g. gpt-5.5 after its Oct 14 2026 retirement.
    const current = listed.models.filter(
      (m) => !(m as { hidden?: boolean }).hidden && !(m as { upgrade?: string | null }).upgrade,
    );
    if (current.length < listed.models.length) {
      console.log(
        `[subscriptions] codex hid ${listed.models.length - current.length} hidden or superseded models`,
      );
    }
    const models = current
      .map((m) => {
        const id = (m as { id?: string; model?: string }).id ?? (m as { model?: string }).model ?? "";
        const name = (m as { displayName?: string }).displayName ?? id;
        return subscriptionModel(`codex/${id}`, `${name} (ChatGPT subscription)`);
      })
      .filter((m) => m.canonicalSlug !== "codex/");
    const defaultId =
      (listed.defaultModel as { id?: string; model?: string } | undefined)?.id ??
      (listed.defaultModel as { model?: string } | undefined)?.model;
    const defaultSlug = defaultId ? `codex/${defaultId}` : (models[0]?.canonicalSlug ?? null);
    console.log(`[subscriptions] codex listed ${models.length} models default=${defaultSlug ?? "none"}`);
    codexModelsCache = { at: Date.now(), models, defaultSlug };
    return codexModelsCache;
  } catch (err) {
    console.warn(
      `[subscriptions] codex model list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { models: [], defaultSlug: null };
  }
}

/** Models offered in the settings picker for a signed-in subscription. */
export async function subscriptionModels(backend: SubscriptionBackend): Promise<SubscriptionModelInfo[]> {
  return backend === "claude-code" ? CLAUDE_CODE_MODELS : (await codexModels()).models;
}

/** Defaults per role when a subscription is the active model backend. */
export async function subscriptionDefaults(backend: SubscriptionBackend): Promise<RoleModelSlugs | null> {
  if (backend === "claude-code") return CLAUDE_CODE_DEFAULTS;
  const { models, defaultSlug } = await codexModels();
  if (!defaultSlug) return null;
  // Subagents fan out in parallel, so use OpenAI's fast tier ("Luna", e.g.
  // gpt-6-luna) when the account has it, like Haiku on Claude. The catalog
  // lists newest first. Schema and orchestrator keep Codex's default
  // (gpt-6.1-sol as of Nov 2026).
  const fast = models.find((m) => /-luna$/.test(m.canonicalSlug))?.canonicalSlug ?? defaultSlug;
  return { schemaInference: defaultSlug, populateOrchestrator: defaultSlug, investigateSubagent: fast };
}

export function subscriptionBackendOf(slug: string): SubscriptionBackend | null {
  if (slug.startsWith("claude-code/")) return "claude-code";
  if (slug.startsWith("codex/")) return "codex";
  return null;
}

function modelIdOf(slug: string): string {
  return slug.slice(slug.indexOf("/") + 1);
}

// ─── CLI discovery ─────────────────────────────────────────────────────────

function findOnPath(command: string): string | undefined {
  const names =
    process.platform === "win32"
      ? [`${command}.exe`, `${command}.cmd`, command]
      : [command];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    // npm scripts put node_modules/.bin first, which holds the CLI copy
    // bundled with the provider package. It lags the user's install and
    // rejects newer plan models (e.g. Codex 0.156 refuses gpt-6.1-sol).
    if (!dir || /[\\/]node_modules[\\/]/.test(dir)) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Prefer the user's installed CLI: it carries their sign-in and stays current.
 * Undefined falls back to the binary bundled with the npm package (used in
 * Docker, where CLAUDE_CODE_OAUTH_TOKEN supplies the subscription login).
 */
function claudePath(): string | undefined {
  return process.env.CLAUDE_CODE_PATH || findOnPath("claude");
}

function codexPath(): string | undefined {
  return process.env.CODEX_PATH || findOnPath("codex");
}

function run(
  file: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; reason?: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000, env: process.env }, (err, stdout) => {
      if (err) {
        const reason =
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "not_installed"
            : err.killed
              ? "timeout"
              : `exit_${(err as { code?: unknown }).code ?? "unknown"}`;
        resolve({ ok: false, stdout: String(stdout ?? ""), reason });
        return;
      }
      resolve({ ok: true, stdout: String(stdout ?? "") });
    });
  });
}

export interface SubscriptionStatus {
  available: boolean;
  /** Plan label when the CLI reports one (e.g. "max", "pro"). Never an email. */
  plan: string | null;
  /** Why it is unavailable: not_installed, not_logged_in, timeout, ... */
  reason: string | null;
}

const STATUS_TTL_MS = 60_000;
const statusCache = new Map<SubscriptionBackend, { at: number; status: SubscriptionStatus }>();

async function probeClaudeCode(): Promise<SubscriptionStatus> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { available: true, plan: null, reason: null };
  }
  const path = claudePath();
  if (!path) return { available: false, plan: null, reason: "not_installed" };
  const result = await run(path, ["auth", "status"]);
  try {
    const parsed = JSON.parse(result.stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
    };
    if (!parsed.loggedIn) return { available: false, plan: null, reason: "not_logged_in" };
    // An API-key login would bill the API, not the subscription. Still usable,
    // but it is the user's key in Claude Code, so we accept it as-is.
    return {
      available: true,
      plan: parsed.subscriptionType ?? parsed.authMethod ?? null,
      reason: null,
    };
  } catch {
    return { available: false, plan: null, reason: result.reason ?? "unreadable_status" };
  }
}

async function probeCodex(): Promise<SubscriptionStatus> {
  const path = codexPath();
  if (!path) return { available: false, plan: null, reason: "not_installed" };
  const result = await run(path, ["login", "status"]);
  if (!result.ok) return { available: false, plan: null, reason: "not_logged_in" };
  const plan = /chatgpt/i.test(result.stdout) ? "chatgpt" : /api key/i.test(result.stdout) ? "api_key" : null;
  return { available: true, plan, reason: null };
}

/** Is this subscription CLI installed and signed in? Cached for 60 s. */
export async function getSubscriptionStatus(
  backend: SubscriptionBackend,
): Promise<SubscriptionStatus> {
  if (env.IS_PROD) return { available: false, plan: null, reason: "disabled_in_production" };
  const cached = statusCache.get(backend);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

  const status = backend === "claude-code" ? await probeClaudeCode() : await probeCodex();
  const previous = cached?.status;
  if (!previous || previous.available !== status.available || previous.reason !== status.reason) {
    console.log(
      `[subscriptions] ${backend} available=${status.available}` +
        (status.plan ? ` plan=${status.plan}` : "") +
        (status.reason ? ` reason=${status.reason}` : ""),
    );
  }
  statusCache.set(backend, { at: Date.now(), status });
  return status;
}

export async function getAllSubscriptionStatuses(): Promise<
  Record<SubscriptionBackend, SubscriptionStatus>
> {
  const [claudeCode, codex] = await Promise.all([
    getSubscriptionStatus("claude-code"),
    getSubscriptionStatus("codex"),
  ]);
  return { "claude-code": claudeCode, codex };
}

// ─── Tool bridging ─────────────────────────────────────────────────────────

/**
 * Call a Mastra tool outside Mastra's agent loop. Mastra validates the input
 * against inputSchema inside execute; the empty context is all our tools need
 * (they read their scope from closures, not from the runtime context).
 */
async function runMastraTool(name: string, mastraTool: BridgeableTool, input: unknown) {
  if (!mastraTool.execute) throw new Error(`Tool ${name} has no execute function`);
  return await mastraTool.execute(input, {});
}

function toAiSdkTools(tools: BridgeableTools): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const [name, mastraTool] of Object.entries(tools)) {
    out[name] = aiTool({
      description: mastraTool.description ?? name,
      inputSchema: mastraTool.inputSchema as ZodType<Record<string, unknown>>,
      execute: (input: unknown) => runMastraTool(name, mastraTool, input),
    });
  }
  return out;
}

// ─── Model construction ────────────────────────────────────────────────────

// An empty scratch directory so the CLIs never pick up a project's files,
// CLAUDE.md or AGENTS.md as context.
const AGENT_CWD = mkdtempSync(join(tmpdir(), "bigset-agent-"));

const claudeCode = createClaudeCode();

/**
 * Names of the user's own MCP servers from $CODEX_HOME/config.toml (headers
 * only, never values) so each can be switched off for BigSet's sessions.
 */
function userCodexMcpServers(): string[] {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  try {
    const toml = readFileSync(join(home, "config.toml"), "utf8");
    const names = new Set<string>();
    for (const m of toml.matchAll(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))/gm)) {
      names.add(m[1] ?? m[2]);
    }
    names.delete(BIGSET_MCP_SERVER);
    return [...names];
  } catch {
    return [];
  }
}

/**
 * Codex otherwise runs with the user's whole setup: their MCP servers
 * (Slack, mail, ...), plugins, skills, hooks, global AGENTS.md, a JS REPL and
 * a shell that can read any file even in the read-only sandbox. A page the
 * agent fetches is untrusted, so a prompt injection could read local secrets
 * and leak them through fetch_page or insert_row. Verified: with Codex
 * defaults the agent read a canary file outside its folder; with these
 * overrides it cannot. Keys from the Codex config reference
 * (learn.chatgpt.com/docs/config-file/config-reference). Also cuts input
 * tokens per call by about half.
 */
function codexIsolationOverrides(): Record<string, string | number | boolean> {
  const userServers = userCodexMcpServers();
  console.log(`[subscriptions] codex isolation: disabling ${userServers.length} user MCP servers`);
  return {
    // BigSet's search_web (TinyFish) replaces Codex's own web search.
    web_search: "disabled",
    "features.shell_tool": false,
    "features.js_repl": false,
    "features.code_mode.enabled": false,
    "features.multi_agent": false,
    "features.apps": false,
    "features.plugins": false,
    "features.remote_plugin": false,
    "features.memories": false,
    "features.chronicle": false,
    "features.hooks": false,
    "features.goals": false,
    "features.view_image": false,
    "skills.bundled.enabled": false,
    "skills.include_instructions": false,
    project_doc_max_bytes: 0,
    ...Object.fromEntries(userServers.map((name) => [`mcp_servers.${name}.enabled`, false])),
  };
}

let codexProvider: CodexAppServerProvider | null = null;
function codex(): CodexAppServerProvider {
  // One long-lived `codex app-server` process serves every call; each call
  // gets its own stateless thread.
  codexProvider ??= createCodexAppServer({
    defaultSettings: {
      codexPath: codexPath(),
      cwd: AGENT_CWD,
      sandboxPolicy: "read-only",
      // Never auto-approve: command and file-change requests are declined.
      autoApprove: false,
      serverRequests: {
        // Approve tool calls to BigSet's own MCP server only.
        onMcpElicitation: async (request) => {
          const params = request.params as { serverName?: string; _meta?: { codex_approval_kind?: string } };
          const ours =
            params.serverName === BIGSET_MCP_SERVER && params._meta?.codex_approval_kind === "mcp_tool_call";
          if (!ours) {
            console.warn(
              `[subscriptions] codex declined ${params._meta?.codex_approval_kind ?? "elicitation"} from server=${params.serverName ?? "unknown"}`,
            );
          }
          return ours ? { action: "accept", content: {} } : { action: "decline", content: null };
        },
      },
      // Don't keep an idle Codex process around (e.g. after the settings
      // page listed models but Claude runs the agents); restarts on demand.
      idleTimeoutMs: 5 * 60_000,
      configOverrides: codexIsolationOverrides(),
    },
  });
  return codexProvider;
}

export async function closeSubscriptionProviders(): Promise<void> {
  if (!codexProvider) return;
  const provider = codexProvider;
  codexProvider = null;
  await provider.close();
}

/**
 * A Claude Code model instance resumes its own previous session on its next
 * call. BigSet resends the full history every call, and sessions are not
 * persisted, so a second call on one instance (e.g. the schema-inference
 * retry) failed with "No conversation found with session ID". Build a fresh
 * instance per call so every call is stateless.
 */
function statelessPerCall(make: () => LanguageModel): LanguageModel {
  const template = make();
  return {
    specificationVersion: template.specificationVersion,
    provider: template.provider,
    modelId: template.modelId,
    supportedUrls: template.supportedUrls,
    doGenerate: (options) => make().doGenerate(options),
    doStream: (options) => make().doStream(options),
  };
}

export interface SubscriptionModelOptions {
  /** Tools the CLI may call. They run in this process via an MCP bridge. */
  tools?: BridgeableTools;
  /** Upper bound on agent turns (Claude Code `maxTurns`). */
  maxSteps?: number;
}

export function subscriptionLanguageModel(
  slug: string,
  { tools = {}, maxSteps }: SubscriptionModelOptions = {},
): LanguageModel {
  if (env.IS_PROD) {
    throw new Error(`"${slug}" needs a local subscription CLI; subscriptions are disabled when PROD=1.`);
  }
  const backend = subscriptionBackendOf(slug);
  const modelId = modelIdOf(slug);
  const toolNames = Object.keys(tools);

  if (backend === "claude-code") {
    const mcpServers =
      toolNames.length > 0
        ? { [BIGSET_MCP_SERVER]: createAiSdkMcpServer(BIGSET_MCP_SERVER, toAiSdkTools(tools)) }
        : undefined;
    return statelessPerCall(() =>
      claudeCode(modelId, {
        pathToClaudeCodeExecutable: claudePath(),
        cwd: AGENT_CWD,
        // No built-in tools (Bash, Read, WebFetch, ...): only BigSet's tools.
        tools: [],
        mcpServers,
        allowedTools: toolNames.map((name) => `mcp__${BIGSET_MCP_SERVER}__${name}`),
        permissionPrompts: "none",
        maxTurns: maxSteps,
        // Keep BigSet's runs out of the user's Claude Code session history.
        persistSession: false,
      }),
    );
  }

  if (backend === "codex") {
    const localTools = Object.entries(tools).map(([name, mastraTool]) =>
      codexTool({
        name,
        description: mastraTool.description ?? name,
        parameters: mastraTool.inputSchema as ZodType<unknown>,
        execute: (input: unknown) => runMastraTool(name, mastraTool, input),
      }),
    );
    return codex()(modelId, {
      mcpServers:
        localTools.length > 0
          ? { [BIGSET_MCP_SERVER]: createSdkMcpServer({ name: BIGSET_MCP_SERVER, tools: localTools }) }
          : undefined,
    });
  }

  throw new Error(`"${slug}" is not a subscription model slug`);
}
