import type { JSONObject, LanguageModelV3 } from "@ai-sdk/provider";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { env } from "../env.js";
import { FETCH_TIMEOUT_MS } from "../fetch-timeout.js";

// OpenRouter app attribution — surfaces BigSet in OpenRouter's public app
// rankings and per-app analytics. HTTP-Referer is the app's unique identifier;
// X-Title is its display name; X-OpenRouter-Categories places it in the
// marketplace (BigSet is an autonomous research agent → "personal-agent").
// Overridable via env for other deployments.
// https://openrouter.ai/docs/app-attribution
const OPENROUTER_APP_URL =
  process.env.OPENROUTER_APP_URL || "https://bigset.tinyfish.ai";
const OPENROUTER_APP_TITLE =
  process.env.OPENROUTER_APP_TITLE || "TinyFish BigSet";
const OPENROUTER_APP_CATEGORIES =
  process.env.OPENROUTER_APP_CATEGORIES || "personal-agent";

export const LLM_PROVIDER_TYPES = [
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
  "groq",
  "togetherai",
  "deepinfra",
  "fireworks",
  "huggingface",
  "ollama",
  "lmstudio",
  "custom",
] as const;

export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number];

export type ModelRoleKey =
  | "schemaInference"
  | "populateOrchestrator"
  | "investigateSubagent";

export interface LlmProviderConfig {
  provider: LlmProviderType;
  apiKey: string;
  defaultModel: string;
  baseUrl?: string;
  source: "local" | "env";
}

export interface LlmProviderInput {
  provider: LlmProviderType;
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
}

export const LLM_PROVIDER_LABELS: Record<LlmProviderType, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistral: "Mistral AI",
  groq: "Groq",
  togetherai: "Together.ai",
  deepinfra: "DeepInfra",
  fireworks: "Fireworks AI",
  huggingface: "Hugging Face",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  custom: "Custom OpenAI-compatible",
};

export const LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE: Record<
  LlmProviderType,
  Record<ModelRoleKey, string>
> = {
  openrouter: {
    schemaInference: env.SCHEMA_INFERENCE_MODEL,
    populateOrchestrator: env.POPULATE_ORCHESTRATOR_MODEL,
    investigateSubagent: env.INVESTIGATE_SUBAGENT_MODEL,
  },
  openai: {
    // Terra is excluded by policy: Sol and Luna bracket it on both quality and
    // price, so it never wins a role. Sol handles the two low-volume roles;
    // Luna (25x cheaper, index 51 vs 59) carries the parallel subagent fan-out.
    schemaInference: "gpt-5.6-sol",
    populateOrchestrator: "gpt-5.6-sol",
    investigateSubagent: "gpt-5.6-luna",
  },
  anthropic: {
    // No cheap tier worth using: Haiku 4.5 is the only sub-Sonnet option and it
    // pairs a weak intelligence score with a Feb 2025 knowledge cutoff, so the
    // subagent stays on Sonnet 5. Anthropic bills the full 1M window at a flat
    // rate (no long-context surcharge), which suits the 80-step orchestrator.
    schemaInference: "claude-sonnet-5",
    populateOrchestrator: "claude-opus-5",
    investigateSubagent: "claude-sonnet-5",
  },
  google: {
    // 3.6 Flash across the board. Gemini 3.5 Flash-Lite is cheaper but defaults
    // to "minimal" thinking, which Google documents as causing premature tool
    // termination on multi-step tasks — exactly the subagent's workload.
    schemaInference: "gemini-3.6-flash",
    populateOrchestrator: "gemini-3.6-flash",
    investigateSubagent: "gemini-3.6-flash",
  },
  xai: {
    // grok-4.5 is the only model xAI still features; the cheaper grok-4.3 is
    // billable but undocumented on the models page, so it is not a safe default.
    schemaInference: "grok-4.5",
    populateOrchestrator: "grok-4.5",
    investigateSubagent: "grok-4.5",
  },
  deepseek: {
    // Flash over Pro deliberately: V4-Flash-0731 is the officially released
    // model (Pro is still Preview and unbenchmarked), it is ~3x cheaper, it has
    // 5x the concurrency limit — which the 3-way subagent fan-out needs — and
    // the Responses API does not support v4-pro at all.
    schemaInference: "deepseek-v4-flash",
    populateOrchestrator: "deepseek-v4-flash",
    investigateSubagent: "deepseek-v4-flash",
  },
  qwen: {
    // DashScope bills every token in a request at the tier its total input size
    // lands in, so a growing agent transcript can reprice the whole call. Only
    // qwen3.7-max and qwen3.5-flash are flat to 1M, hence their roles here.
    // Schema inference avoids qwen3.7-max: it is missing from Alibaba's
    // JSON-mode support list, while qwen3.6-plus is on it.
    schemaInference: "qwen3.6-plus",
    populateOrchestrator: "qwen3.7-max",
    investigateSubagent: "qwen3.5-flash",
  },
  mistral: {
    // Large 3 is both cheaper than Medium 3.5 and rated by Mistral as the
    // stronger generalist; Medium is their agent/coding-tuned model, so it
    // takes the orchestrator. Small 4 keeps function calling and structured
    // outputs at a fraction of Medium's output rate.
    schemaInference: "mistral-large-latest",
    populateOrchestrator: "mistral-medium-latest",
    investigateSubagent: "mistral-small-latest",
  },
  groq: {
    // Effectively a single-model provider for us: gpt-oss-120b is the only
    // production model with real structured-output support that also has tool
    // calling. The Llama models are JSON-object-mode only, everything stronger
    // is preview-tier, and the compound systems reject user-provided tools.
    schemaInference: "openai/gpt-oss-120b",
    populateOrchestrator: "openai/gpt-oss-120b",
    investigateSubagent: "openai/gpt-oss-120b",
  },
  togetherai: {
    schemaInference: "deepseek-ai/DeepSeek-V4-Flash-0731",
    populateOrchestrator: "deepseek-ai/DeepSeek-V4-Flash-0731",
    investigateSubagent: "deepseek-ai/DeepSeek-V4-Flash-0731",
  },
  deepinfra: {
    schemaInference: "deepseek-ai/DeepSeek-V4-Flash-0731",
    populateOrchestrator: "deepseek-ai/DeepSeek-V4-Flash-0731",
    investigateSubagent: "deepseek-ai/DeepSeek-V4-Flash-0731",
  },
  fireworks: {
    // Not the -0731 snapshot: it resolves on Fireworks but has no row in the
    // serverless pricing table, which Fireworks calls the source of truth, so
    // it may be dedicated-only. The unsuffixed slug is confirmed serverless.
    schemaInference: "accounts/fireworks/models/deepseek-v4-flash",
    populateOrchestrator: "accounts/fireworks/models/deepseek-v4-flash",
    investigateSubagent: "accounts/fireworks/models/deepseek-v4-flash",
  },
  huggingface: {
    // The ":deepinfra" pin is load-bearing. A bare repo id auto-routes to the
    // fastest provider, and structured-output support varies per provider for
    // the same model — Novita and Fireworks serve this one without it, which
    // would break schema inference intermittently. DeepInfra supports both
    // tool calling and structured output.
    schemaInference: "deepseek-ai/DeepSeek-V4-Flash:deepinfra",
    populateOrchestrator: "deepseek-ai/DeepSeek-V4-Flash:deepinfra",
    investigateSubagent: "deepseek-ai/DeepSeek-V4-Flash:deepinfra",
  },
  ollama: {
    schemaInference: "",
    populateOrchestrator: "",
    investigateSubagent: "",
  },
  lmstudio: {
    schemaInference: "",
    populateOrchestrator: "",
    investigateSubagent: "",
  },
  custom: {
    schemaInference: "",
    populateOrchestrator: "",
    investigateSubagent: "",
  },
};

export const LLM_PROVIDER_DEFAULT_MODELS: Record<LlmProviderType, string> = {
  openrouter: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.openrouter.schemaInference,
  openai: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.openai.schemaInference,
  anthropic: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.anthropic.schemaInference,
  google: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.google.schemaInference,
  xai: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.xai.schemaInference,
  deepseek: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.deepseek.schemaInference,
  qwen: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.qwen.schemaInference,
  mistral: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.mistral.schemaInference,
  groq: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.groq.schemaInference,
  togetherai: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.togetherai.schemaInference,
  deepinfra: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.deepinfra.schemaInference,
  fireworks: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.fireworks.schemaInference,
  huggingface: LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE.huggingface.schemaInference,
  ollama: "",
  lmstudio: "",
  custom: "",
};

/**
 * Canonical reasoning scale.
 *
 * Every provider exposes a different ladder — xAI has two rungs, Anthropic has
 * five, Qwen isn't a ladder at all (a boolean plus a token budget) — so there
 * is no shared vocabulary to pass through. We keep one 5-stop scale that the UI
 * and stored config speak, and project it onto whatever each provider accepts
 * in {@link reasoningProviderOptions}. Ordered weakest → strongest.
 */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    typeof value === "string" &&
    (REASONING_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Per-provider projection of the canonical scale onto native provider options.
 *
 * A `null` provider has no reasoning knob we can drive (its models either don't
 * reason or the SDK exposes no typed control), so we send nothing and let the
 * provider's own default stand — `reasoningSupported` reports that to the UI so
 * the control can be disabled rather than silently ignored.
 *
 * Where a provider's ladder is coarser than ours, several canonical levels
 * collapse onto the same native rung; that is intended and lossless in the only
 * direction that matters (the user's choice is never silently *raised*).
 */
const REASONING_PROVIDER_OPTIONS: Record<
  LlmProviderType,
  Record<ReasoningLevel, JSONObject> | null
> = {
  // none | minimal | low | medium | high | xhigh
  openai: {
    none: { reasoningEffort: "none" },
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "xhigh" },
  },
  // none | minimal | low | medium | high | xhigh
  openrouter: {
    none: { reasoning: { effort: "none" } },
    low: { reasoning: { effort: "low" } },
    medium: { reasoning: { effort: "medium" } },
    high: { reasoning: { effort: "high" } },
    max: { reasoning: { effort: "xhigh" } },
  },
  // low | medium | high | xhigh | max — adaptive thinking has no "off" rung,
  // so "none" lands on the lowest effort the API accepts.
  anthropic: {
    none: { effort: "low" },
    low: { effort: "low" },
    medium: { effort: "medium" },
    high: { effort: "high" },
    max: { effort: "max" },
  },
  // minimal | low | medium | high
  google: {
    none: { thinkingConfig: { thinkingLevel: "minimal" } },
    low: { thinkingConfig: { thinkingLevel: "low" } },
    medium: { thinkingConfig: { thinkingLevel: "medium" } },
    high: { thinkingConfig: { thinkingLevel: "high" } },
    max: { thinkingConfig: { thinkingLevel: "high" } },
  },
  // low | high only
  xai: {
    none: { reasoningEffort: "low" },
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "low" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "high" },
  },
  // low | medium | high | xhigh | max
  deepseek: {
    none: { reasoningEffort: "low" },
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "max" },
  },
  // none | high only
  mistral: {
    none: { reasoningEffort: "none" },
    low: { reasoningEffort: "none" },
    medium: { reasoningEffort: "high" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "high" },
  },
  // none | default | low | medium | high
  groq: {
    none: { reasoningEffort: "none" },
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "high" },
  },
  // Not a ladder: a thinking toggle plus a token budget.
  qwen: {
    none: { enableThinking: false },
    low: { enableThinking: true, thinkingBudget: 1024 },
    medium: { enableThinking: true, thinkingBudget: 4096 },
    high: { enableThinking: true, thinkingBudget: 16384 },
    max: { enableThinking: true, thinkingBudget: 32768 },
  },
  // Also a toggle plus a budget, under a `thinking` object.
  fireworks: {
    none: { thinking: { type: "disabled" } },
    low: { thinking: { type: "enabled", budgetTokens: 1024 } },
    medium: { thinking: { type: "enabled", budgetTokens: 4096 } },
    high: { thinking: { type: "enabled", budgetTokens: 16384 } },
    max: { thinking: { type: "enabled", budgetTokens: 32768 } },
  },
  // These route to OpenAI-compatible endpoints whose SDK wrappers expose no
  // typed reasoning control. Sending an unrecognised parameter risks a 400 on
  // strict gateways, so we leave their defaults alone.
  togetherai: null,
  deepinfra: null,
  huggingface: null,
  ollama: null,
  lmstudio: null,
  custom: null,
};

/**
 * The provider-options namespace each provider reads. Usually the provider id,
 * but Qwen is served by the Alibaba provider and keys off its own name.
 */
const REASONING_OPTIONS_NAMESPACE: Partial<Record<LlmProviderType, string>> = {
  qwen: "alibaba",
};

/** Whether the reasoning control does anything for this provider. */
export function reasoningSupported(provider: LlmProviderType): boolean {
  return REASONING_PROVIDER_OPTIONS[provider] !== null;
}

/**
 * Build the `providerOptions` payload for a reasoning level, or `undefined`
 * when the provider has no knob to drive.
 */
export function reasoningProviderOptions(
  provider: LlmProviderType,
  level: ReasoningLevel,
): Record<string, JSONObject> | undefined {
  const projection = REASONING_PROVIDER_OPTIONS[provider];
  if (!projection) return undefined;
  const namespace = REASONING_OPTIONS_NAMESPACE[provider] ?? provider;
  return { [namespace]: projection[level] };
}

/**
 * Default reasoning per provider and role, used when a user has not chosen one.
 *
 * The rule is inverse to model strength: a role running a frontier model needs
 * less deliberation to reach the same answer than the same role running a cheap
 * one, so weaker defaults get more thinking and stronger defaults get less.
 * Roles matter too — schema inference is one short structured call, while the
 * orchestrator and the research subagents run long tool loops where premature
 * termination is the common failure. These are tuned against each provider's
 * default model in {@link LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE}; when a user
 * picks a different model they can override per role.
 */
export const LLM_PROVIDER_DEFAULT_REASONING_BY_ROLE: Record<
  LlmProviderType,
  Record<ModelRoleKey, ReasoningLevel>
> = {
  // Sol is strong enough to coast; Luna is cheap and needs the headroom.
  openai: {
    schemaInference: "low",
    populateOrchestrator: "medium",
    investigateSubagent: "high",
  },
  // Opus 5 orchestrates comfortably at medium; Sonnet 5 works harder as a
  // subagent. Anthropic defaults to `high` everywhere, so this also trims cost.
  anthropic: {
    schemaInference: "low",
    populateOrchestrator: "medium",
    investigateSubagent: "high",
  },
  // 3.6 Flash defaults to high thinking on every call; dial back the cheap
  // structured call and keep the depth where tool loops need it.
  google: {
    schemaInference: "low",
    populateOrchestrator: "medium",
    investigateSubagent: "high",
  },
  // Only two rungs, so anything below "high" collapses to low.
  xai: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  deepseek: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  // Mistral's ladder is off/on and its models are the weakest here — leave
  // reasoning on wherever it does real work.
  mistral: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  // gpt-oss-120b is the weakest default in the table and has no parallel tool
  // calling, so it gets maximum deliberation on both agent roles.
  groq: {
    schemaInference: "medium",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  qwen: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "medium",
  },
  fireworks: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  // No knob — recorded so every provider resolves to a concrete level and the
  // UI has something to show if support is added later.
  openrouter: {
    schemaInference: "low",
    populateOrchestrator: "medium",
    investigateSubagent: "high",
  },
  togetherai: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  deepinfra: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  huggingface: {
    schemaInference: "low",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  ollama: {
    schemaInference: "medium",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  lmstudio: {
    schemaInference: "medium",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
  custom: {
    schemaInference: "medium",
    populateOrchestrator: "high",
    investigateSubagent: "high",
  },
};

export function defaultReasoningForLlmProviderRole(
  provider: LlmProviderType,
  role: ModelRoleKey,
): ReasoningLevel {
  return LLM_PROVIDER_DEFAULT_REASONING_BY_ROLE[provider][role];
}

export function isLlmProviderType(value: unknown): value is LlmProviderType {
  return (
    typeof value === "string" &&
    (LLM_PROVIDER_TYPES as readonly string[]).includes(value)
  );
}

export function llmProviderLabel(provider: LlmProviderType): string {
  return LLM_PROVIDER_LABELS[provider];
}

export function defaultModelForLlmProvider(provider: LlmProviderType): string {
  return LLM_PROVIDER_DEFAULT_MODELS[provider];
}

export function defaultModelForLlmProviderRole(
  provider: LlmProviderType,
  role: ModelRoleKey,
): string {
  return LLM_PROVIDER_DEFAULT_MODELS_BY_ROLE[provider][role];
}

export function defaultBaseUrlForLlmProvider(
  provider: LlmProviderType,
): string | undefined {
  if (provider === "openrouter") {
    return env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  }
  if (provider === "google") {
    return (
      env.GOOGLE_GENERATIVE_AI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta"
    );
  }
  if (provider === "xai") {
    return env.XAI_BASE_URL || "https://api.x.ai/v1";
  }
  if (provider === "deepseek") {
    return env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  }
  if (provider === "qwen") {
    return (
      env.QWEN_BASE_URL ||
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    );
  }
  if (provider === "mistral") {
    return env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1";
  }
  if (provider === "groq") {
    return env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
  }
  if (provider === "togetherai") {
    return env.TOGETHER_BASE_URL || "https://api.together.xyz/v1";
  }
  if (provider === "deepinfra") {
    return env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1";
  }
  if (provider === "fireworks") {
    return (
      env.FIREWORKS_BASE_URL ||
      "https://api.fireworks.ai/inference/v1"
    );
  }
  if (provider === "huggingface") {
    return env.HUGGINGFACE_BASE_URL || "https://router.huggingface.co/v1";
  }
  if (provider === "ollama") {
    return env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
  }
  if (provider === "lmstudio") {
    return env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
  }
  return undefined;
}

function isOpenAiCompatibleProvider(provider: LlmProviderType): boolean {
  return provider === "custom" || provider === "ollama" || provider === "lmstudio";
}

function providerAllowsMissingApiKey(provider: LlmProviderType): boolean {
  return isOpenAiCompatibleProvider(provider);
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(
    hostname,
  );
}

function normalizeLocalLoopbackForBackend(parsed: URL): void {
  if (env.IS_LOCAL_MODE && isLoopbackHost(parsed.hostname)) {
    // In local dev the backend runs inside Docker. From the container,
    // localhost points at the container, not the host machine where LM Studio
    // and other local OpenAI-compatible servers usually listen.
    parsed.hostname = "host.docker.internal";
  }
}

export function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Base URL must start with http:// or https://");
  }
  normalizeLocalLoopbackForBackend(parsed);
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeCustomBaseUrl(baseUrl?: string): string | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return undefined;

  const parsed = new URL(normalized);
  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/v1";
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeLlmProviderInput(
  input: LlmProviderInput,
  source: "local" | "env",
): LlmProviderConfig {
  const provider = input.provider;
  const apiKey = input.apiKey.trim();
  if (!apiKey && !providerAllowsMissingApiKey(provider)) {
    throw new Error(`${llmProviderLabel(provider)} API key is required`);
  }

  const baseUrl =
    isOpenAiCompatibleProvider(provider)
      ? normalizeCustomBaseUrl(
          input.baseUrl ?? defaultBaseUrlForLlmProvider(provider),
        )
      : normalizeBaseUrl(input.baseUrl) ?? defaultBaseUrlForLlmProvider(provider);

  if (isOpenAiCompatibleProvider(provider) && !baseUrl) {
    throw new Error(`${llmProviderLabel(provider)} requires a base URL`);
  }

  const defaultModel =
    input.defaultModel?.trim() || defaultModelForLlmProvider(provider);

  return {
    provider,
    apiKey,
    defaultModel,
    baseUrl,
    source,
  };
}

/**
 * Build a language model for a provider config.
 *
 * When `reasoning` is given it is baked into the model with
 * `defaultSettingsMiddleware`, so every caller — `generateText` and the Mastra
 * agents alike — inherits it without threading provider options through each
 * call site. Providers with no reasoning knob are returned unwrapped.
 */
export function createLanguageModel(
  config: LlmProviderConfig,
  modelId?: string,
  reasoning?: ReasoningLevel,
): LanguageModelV3 {
  const model = createBaseLanguageModel(config, modelId);
  if (!reasoning) return model;

  const providerOptions = reasoningProviderOptions(config.provider, reasoning);
  if (!providerOptions) return model;

  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions } }),
  });
}

function createBaseLanguageModel(
  config: LlmProviderConfig,
  modelId?: string,
): LanguageModelV3 {
  const resolvedModelId = (modelId?.trim() || config.defaultModel).trim();
  if (!resolvedModelId) {
    throw new Error("Model name is required");
  }

  switch (config.provider) {
    case "openrouter": {
      const provider = createOpenRouter({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        headers: {
          "HTTP-Referer": OPENROUTER_APP_URL,
          "X-Title": OPENROUTER_APP_TITLE,
          "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORIES,
        },
      });
      return provider(resolvedModelId);
    }
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "xai": {
      const provider = createXai({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "deepseek": {
      const provider = createDeepSeek({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "qwen": {
      const provider = createAlibaba({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "mistral": {
      const provider = createMistral({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "groq": {
      const provider = createGroq({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "togetherai": {
      const provider = createTogetherAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "deepinfra": {
      const provider = createDeepInfra({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "fireworks": {
      const provider = createFireworks({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "huggingface": {
      const provider = createHuggingFace({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
    case "ollama":
    case "lmstudio":
    case "custom": {
      if (!config.baseUrl) {
        throw new Error(`${llmProviderLabel(config.provider)} requires a base URL`);
      }
      const provider = createOpenAICompatible({
        name: config.provider,
        apiKey: config.apiKey || undefined,
        baseURL: config.baseUrl,
      });
      return provider(resolvedModelId);
    }
  }
}

export function modelsUrlForLlmProvider(
  provider: LlmProviderType,
  baseUrl?: string,
): string {
  const resolvedBaseUrl = (
    baseUrl ||
    defaultBaseUrlForLlmProvider(provider) ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  if (provider === "deepinfra") {
    return resolvedBaseUrl.endsWith("/openai")
      ? `${resolvedBaseUrl}/models`
      : `${resolvedBaseUrl}/openai/models`;
  }

  return `${resolvedBaseUrl}/models`;
}

type ProviderVerificationRequest = {
  url: string;
  headers: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  fallbackStatuses?: number[];
};

function openAiStyleModelsVerificationRequest(
  config: LlmProviderConfig,
): ProviderVerificationRequest {
  return {
    url: modelsUrlForLlmProvider(config.provider, config.baseUrl),
    headers: { Authorization: `Bearer ${config.apiKey}` },
  };
}

function qwenChatVerificationRequest(
  config: LlmProviderConfig,
): ProviderVerificationRequest {
  const baseUrl = (
    config.baseUrl ||
    defaultBaseUrlForLlmProvider("qwen") ||
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  ).replace(/\/+$/, "");

  return {
    url: `${baseUrl}/chat/completions`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.defaultModel || defaultModelForLlmProvider("qwen"),
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
  };
}

function providerVerificationRequests(
  config: LlmProviderConfig,
): ProviderVerificationRequest[] {
  switch (config.provider) {
    case "openrouter": {
      const baseUrl = (config.baseUrl || "https://openrouter.ai/api/v1").replace(
        /\/+$/,
        "",
      );
      return [{
        url: `${baseUrl}/key`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      }];
    }
    case "openai": {
      const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(
        /\/+$/,
        "",
      );
      return [{
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      }];
    }
    case "anthropic": {
      const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(
        /\/+$/,
        "",
      );
      return [{
        url: `${baseUrl}/models?limit=1`,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
      }];
    }
    case "google": {
      const baseUrl = (
        config.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
      ).replace(/\/+$/, "");
      return [{
        url: `${baseUrl}/models`,
        headers: { "x-goog-api-key": config.apiKey },
      }];
    }
    case "qwen": {
      return [
        {
          ...openAiStyleModelsVerificationRequest(config),
          fallbackStatuses: [404, 405],
        },
        qwenChatVerificationRequest(config),
      ];
    }
    case "xai":
    case "deepseek":
    case "mistral":
    case "groq":
    case "togetherai":
    case "deepinfra":
    case "fireworks":
    case "huggingface": {
      return [openAiStyleModelsVerificationRequest(config)];
    }
    case "ollama":
    case "lmstudio":
    case "custom": {
      if (!config.baseUrl) {
        throw new Error(`${llmProviderLabel(config.provider)} requires a base URL`);
      }
      const baseUrl = config.baseUrl.replace(/\/+$/, "");
      return [{
        url: `${baseUrl}/models`,
        headers: config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {},
      }];
    }
  }
}

export async function verifyLlmProviderConfig(
  config: LlmProviderConfig,
): Promise<void> {
  const requests = providerVerificationRequests(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let lastResponseStatus: number | undefined;
  let lastUrl: string | undefined;

  try {
    for (const request of requests) {
      lastUrl = request.url;
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      if (response.ok) return;

      lastResponseStatus = response.status;
      if (request.fallbackStatuses?.includes(response.status)) {
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `${llmProviderLabel(config.provider)} rejected that API key.`,
        );
      }
      throw new Error(
        `${llmProviderLabel(config.provider)} verification failed with HTTP ${response.status}.`,
      );
    }

    throw new Error(
      `${llmProviderLabel(config.provider)} verification failed with HTTP ${lastResponseStatus ?? "unknown"}.`,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${llmProviderLabel(config.provider)} verification timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    if (err instanceof Error && err.message === "fetch failed") {
      const displayUrl = (lastUrl ?? requests[0]?.url ?? "").replace(
        "host.docker.internal",
        "localhost",
      );
      const localHint =
        config.provider === "ollama"
          ? " Start Ollama and confirm the OpenAI-compatible endpoint is enabled."
          : config.provider === "lmstudio"
            ? " Start the LM Studio local server and confirm the port."
            : config.provider === "custom"
              ? " Check that the endpoint is running and reachable."
              : "";
      throw new Error(
        `${llmProviderLabel(config.provider)} verification failed: could not reach ${displayUrl}.${localHint}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
