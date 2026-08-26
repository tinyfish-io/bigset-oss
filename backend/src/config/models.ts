/**
 * Backend configuration for AI models.
 *
 * Defines the typed interfaces and constants for model management.
 */

import { api, internal, convex } from "../convex.js";
import { env } from "../env.js";
import { getLlmProviderConfig, requireOpenRouterApiKey } from "../local-credentials.js";
import { FETCH_TIMEOUT_MS } from "../fetch-timeout.js";
import {
  defaultBaseUrlForLlmProvider,
  defaultModelForLlmProviderRole,
  defaultReasoningForLlmProviderRole,
  isReasoningLevel,
  modelsUrlForLlmProvider,
  type LlmProviderType,
  type ModelRoleKey,
  type ReasoningLevel,
} from "./llm.js";

export interface OpenRouterModel {
  modelName: string;
  canonicalSlug: string;
  contextLength: number;
  completionCost: number;
  promptCost: number;
}

/**
 * Default model identifiers for each agent role.
 * Read from environment variables so operators can change production defaults
 * without touching code. Local mode falls back to the selected LLM provider's
 * default model first.
 */
export const DEFAULT_MODEL_IDS = {
  SCHEMA_INFERENCE: env.SCHEMA_INFERENCE_MODEL,
  POPULATE_ORCHESTRATOR: env.POPULATE_ORCHESTRATOR_MODEL,
  INVESTIGATE_SUBAGENT: env.INVESTIGATE_SUBAGENT_MODEL,
} as const;

const OPENAI_MODEL_EXCLUDE_PATTERNS = [
  "audio",
  "babbage",
  "dall-e",
  "davinci",
  "embedding",
  "image",
  "instruct",
  "moderation",
  "realtime",
  "sora",
  "transcribe",
  "tts",
  "whisper",
];

const GOOGLE_MODEL_EXCLUDE_PATTERNS = [
  "audio",
  "embedding",
  "imagen",
  "image",
  "live",
  "lyria",
  "nano-banana",
  "robotics",
  "tts",
  "veo",
];

const TEXT_MODEL_EXCLUDE_PATTERNS = [
  "audio",
  "babbage",
  "dall-e",
  "embedding",
  "image",
  "moderation",
  "rerank",
  "safeguard",
  "sdxl",
  "speech",
  "stable-diffusion",
  "transcribe",
  "tts",
  "video",
  "voice",
  "wan",
  "whisper",
];

// Static picker list for Qwen (DashScope has no reliable public models
// endpoint). The newer qwen3.6-* / qwen3.7-* slugs are served in the
// International / Chinese-mainland deployments; the US (Virginia) region
// currently only exposes qwen-plus and qwen-flash, so both are kept in the list.
const QWEN_MODELS: OpenRouterModel[] = [
  "qwen3.7-max",
  "qwen3.6-max-preview",
  "qwen3-max",
  "qwen-max",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen-plus",
  "qwen3.6-flash",
  "qwen3.5-flash",
  "qwen-flash",
  "qwen-turbo",
].map((slug) => ({
  modelName: slug,
  canonicalSlug: slug,
  contextLength: 0,
  completionCost: 0,
  promptCost: 0,
}));

function isOpenAITextModelId(id: string): boolean {
  const lower = id.toLowerCase();
  if (OPENAI_MODEL_EXCLUDE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return false;
  }
  return (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("chatgpt-")
  );
}

function isGenericTextModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return !TEXT_MODEL_EXCLUDE_PATTERNS.some((pattern) =>
    lower.includes(pattern),
  );
}

function isGoogleTextModelId(id: string): boolean {
  const lower = id.toLowerCase();
  if (GOOGLE_MODEL_EXCLUDE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return false;
  }
  return (
    lower.startsWith("gemini-") ||
    lower.startsWith("gemma-") ||
    lower.startsWith("deep-research-")
  );
}

function isMistralTextModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    isGenericTextModelId(id) &&
    (lower.startsWith("mistral-") ||
      lower.startsWith("magistral-") ||
      lower.startsWith("ministral-") ||
      lower.startsWith("codestral-") ||
      lower.startsWith("devstral-") ||
      lower.startsWith("pixtral-"))
  );
}

function isProviderTextModelId(
  id: string,
  provider: Awaited<ReturnType<typeof getLlmProviderConfig>>,
): boolean {
  if (!provider) return true;
  switch (provider.provider) {
    case "openrouter":
      return id.includes("/");
    case "openai":
      return isOpenAITextModelId(id) && !id.includes("/");
    case "anthropic":
      return id.startsWith("claude-") && !id.includes("/");
    case "google":
      return isGoogleTextModelId(id) && !id.includes("/");
    case "xai":
      return id.startsWith("grok-") && !id.includes("imagine");
    case "deepseek":
      return id.startsWith("deepseek-");
    case "qwen":
      return id.startsWith("qwen") || id.startsWith("qwq-");
    case "mistral":
      return isMistralTextModelId(id);
    case "groq":
    case "togetherai":
    case "deepinfra":
    case "fireworks":
    case "huggingface":
      return isGenericTextModelId(id);
    case "ollama":
    case "lmstudio":
    case "custom":
      return true;
  }
}

function googleModelIdFromName(name: string): string {
  return name.replace(/^models\//, "");
}

/**
 * Reduce a slug to the form the provider's own model list uses.
 *
 * The Hugging Face router addresses models as `<repo>:<routing-target>`, where
 * the suffix pins which inference provider serves the request (or picks a
 * policy like `:cheapest`). Its `/v1/models` listing only ever returns the bare
 * repo id, so a pinned slug would otherwise look unsupported even though it is
 * the more precise — and for structured output, the more correct — address.
 */
function canonicalModelSlugForProvider(
  slug: string,
  provider: LlmProviderType | undefined,
): string {
  if (provider === "huggingface") {
    const separator = slug.lastIndexOf(":");
    if (separator > 0) return slug.slice(0, separator);
  }
  return slug;
}

function sortModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return models.sort((a, b) => a.modelName.localeCompare(b.modelName));
}

function isModelCompatibleWithProvider(
  modelId: string | undefined,
  provider: Awaited<ReturnType<typeof getLlmProviderConfig>>,
): modelId is string {
  if (!modelId) return false;
  return isProviderTextModelId(modelId, provider);
}

function modelForProvider(
  savedModel: string | undefined,
  role: ModelRoleKey,
  envDefault: string,
  provider: Awaited<ReturnType<typeof getLlmProviderConfig>>,
): string {
  if (isModelCompatibleWithProvider(savedModel, provider)) return savedModel;
  if (provider?.provider) return defaultModelForLlmProviderRole(provider.provider, role);
  return envDefault;
}

/**
 * Resolve the reasoning level for a role.
 *
 * A stored level is an explicit user override and always wins. Anything else —
 * unset, or a value from an older build that is no longer on the scale — falls
 * back to "auto", meaning the provider/role default is recomputed now. That is
 * what makes switching a role to a weaker model raise its reasoning on its own.
 */
function reasoningForProvider(
  savedLevel: string | undefined,
  role: ModelRoleKey,
  provider: LlmProviderType | undefined,
): ReasoningLevel {
  if (isReasoningLevel(savedLevel)) return savedLevel;
  return defaultReasoningForLlmProviderRole(provider ?? "openrouter", role);
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Model list request failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Model roles for the settings UI.
 */
export const MODEL_ROLES = [
  { key: "schemaInference", label: "Schema Inference" },
  { key: "populateOrchestrator", label: "Populate Orchestrator" },
  { key: "investigateSubagent", label: "Investigate Subagent" },
] as const;

/**
 * Models explicitly excluded from the list.
 * These are models that we exclude from the OpenRouter fetch results
 * based on known incompatibilities or undesirability for our use case.
 */
export const EXCLUDED_MODEL_SLUGS: string[] = [];

/**
 * Fetch all cached models from Convex.
 * If the cache is empty, fetches from OpenRouter, stores in Convex, and returns.
 */
export async function getCachedModels(): Promise<OpenRouterModel[]> {
  const models = await convex.query(api.openRouterModels.list, {});
  const cached = models as unknown as OpenRouterModel[];
  if (cached.length > 0) return cached;

  const fetched = await fetchModelsFromOpenRouter();
  await upsertModelBatch(fetched);
  return fetched;
}

export async function fetchModelsForCurrentLlmProvider(): Promise<OpenRouterModel[]> {
  const config = await getLlmProviderConfig();
  if (!config) {
    throw new Error("LLM provider is not configured.");
  }

  if (config.provider === "openrouter") {
    return await getCachedModels();
  }

  if (config.provider === "anthropic") {
    const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    const json = await fetchJsonWithTimeout<{
      data?: Array<{
        id: string;
        display_name?: string;
        max_input_tokens?: number;
      }>;
    }>(`${baseUrl}/models?limit=100`, {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    });

    return sortModels(
      (json.data ?? []).map((model) => ({
        modelName: model.display_name ?? model.id,
        canonicalSlug: model.id,
        contextLength: model.max_input_tokens ?? 0,
        completionCost: 0,
        promptCost: 0,
      })),
    );
  }

  if (config.provider === "google") {
    const baseUrl = (
      config.baseUrl ||
      defaultBaseUrlForLlmProvider("google") ||
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
    const json = await fetchJsonWithTimeout<{
      models?: Array<{
        name: string;
        baseModelId?: string;
        displayName?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedActions?: string[];
        supportedGenerationMethods?: string[];
      }>;
    }>(`${baseUrl}/models`, {
      "x-goog-api-key": config.apiKey,
    });

    return sortModels(
      (json.models ?? [])
        .map((model) => {
          const modelId = model.baseModelId || googleModelIdFromName(model.name);
          return {
            model,
            modelId,
            actions:
              model.supportedActions ?? model.supportedGenerationMethods ?? [],
          };
        })
        .filter(({ modelId, actions }) => {
          return (
            isGoogleTextModelId(modelId) &&
            (actions.length === 0 || actions.includes("generateContent"))
          );
        })
        .map(({ model, modelId }) => ({
          modelName: model.displayName ?? modelId,
          canonicalSlug: modelId,
          contextLength: model.inputTokenLimit ?? 0,
          completionCost: 0,
          promptCost: 0,
        })),
    );
  }

  if (config.provider === "qwen") {
    return sortModels([...QWEN_MODELS]);
  }

  const baseUrl = (
    config.baseUrl ||
    defaultBaseUrlForLlmProvider(config.provider) ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const headers: Record<string, string> =
    ["custom", "ollama", "lmstudio"].includes(config.provider) && !config.apiKey
      ? {}
      : { Authorization: `Bearer ${config.apiKey}` };
  const json = await fetchJsonWithTimeout<{
    data?: Array<{
      id: string;
      display_name?: string;
      name?: string;
      context_length?: number;
      contextLength?: number;
    }>;
  }>(modelsUrlForLlmProvider(config.provider, baseUrl), headers);

  const models = (json.data ?? [])
    .filter((model) => isProviderTextModelId(model.id, config))
    .map((model) => ({
      modelName: model.display_name ?? model.name ?? model.id,
      canonicalSlug: model.id,
      contextLength: model.context_length ?? model.contextLength ?? 0,
      completionCost: 0,
      promptCost: 0,
    }));

  return sortModels(models);
}

/**
 * Providers whose full model catalog we cannot reliably enumerate, so a
 * membership check would produce false rejections:
 *   - custom / ollama / lmstudio — local/custom OpenAI-compatible endpoints
 *   - qwen — served from a small static stub (QWEN_MODELS), not a live catalog
 * Slugs for these providers are accepted as-is; for every other provider a
 * saved slug must appear in the provider's live model list.
 */
export function providerAllowsAnyModelSlug(provider: LlmProviderType): boolean {
  return (
    provider === "custom" ||
    provider === "ollama" ||
    provider === "lmstudio" ||
    provider === "qwen"
  );
}

/**
 * Hard-validate the slugs a user is trying to save against the CURRENT LLM
 * provider's actual model list. Returns the subset of slugs the provider does
 * not offer (empty array = all valid).
 *
 * Local/custom endpoints (see {@link providerAllowsAnyModelSlug}) are exempt —
 * their catalogs can't be enumerated — so they always return an empty array.
 *
 * Throws if the provider's model list can't be fetched, so callers can fail
 * closed rather than persist a slug that will only break at runtime.
 */
export async function findUnsupportedModelSlugs(
  slugs: string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];

  const config = await getLlmProviderConfig();
  if (config && providerAllowsAnyModelSlug(config.provider)) return [];

  const models = await fetchModelsForCurrentLlmProvider();
  const available = new Set(models.map((m) => m.canonicalSlug));
  const isAvailable = (slug: string, offered: Set<string>) =>
    offered.has(slug) ||
    offered.has(canonicalModelSlugForProvider(slug, config?.provider));
  let missing = slugs.filter((slug) => !isAvailable(slug, available));

  // OpenRouter is served from a persistent Convex cache with no TTL, so a
  // stale cache that predates a model's release would falsely reject a slug the
  // provider actually offers. Refresh once and re-check before rejecting.
  if (missing.length > 0 && config?.provider === "openrouter") {
    const fresh = await fetchModelsFromOpenRouter();
    await upsertModelBatch(fresh);
    const refreshed = new Set(fresh.map((m) => m.canonicalSlug));
    missing = missing.filter((slug) => !isAvailable(slug, refreshed));
  }

  return missing;
}

/**
 * Validate that a model slug exists in the cached model list.
 * Throws with a clear message if the slug is not found.
 * Should be called before using any model from user config.
 */
export async function validateModelSlug(
  slug: string,
  role: "schemaInference" | "populateOrchestrator" | "investigateSubagent"
): Promise<void> {
  const models = await getCachedModels();
  const found = models.some((m) => m.canonicalSlug === slug);
  if (!found) {
    throw new Error(
      `Invalid model slug "${slug}" for ${role}. ` +
        `Available models: ${models.map((m) => m.canonicalSlug).join(", ") || "none (run /openrouter/refresh first)"}`
    );
  }
}

/**
 * Upsert a batch of models to Convex.
 * Called after successfully fetching from OpenRouter API.
 */
export async function upsertModelBatch(models: OpenRouterModel[]): Promise<void> {
  await convex.mutation(internal.openRouterModels.upsertBatch, { models });
}

/**
 * Upsert the model configuration for a specific user in Convex.
 * Only fields that are explicitly provided (not undefined) are updated.
 * Unset fields retain their existing values.
 */
export async function upsertModelConfig(
  userId: string,
  config: {
    schemaInference?: string;
    populateOrchestrator?: string;
    investigateSubagent?: string;
    schemaInferenceReasoning?: string;
    populateOrchestratorReasoning?: string;
    investigateSubagentReasoning?: string;
  },
  /**
   * Roles whose reasoning override should be removed, returning them to the
   * provider/role default. Distinct from "not provided", which leaves the
   * stored value untouched.
   */
  clearReasoning?: Partial<Record<ModelRoleKey, boolean>>,
): Promise<void> {
  const llmConfig = await getLlmProviderConfig();
  const reasoning = (role: ModelRoleKey, value: string | undefined) =>
    clearReasoning?.[role] ? null : value;

  await convex.mutation(internal.modelConfig.upsertInternal, {
    userId,
    provider: llmConfig?.provider ?? "openrouter",
    schemaInference: config.schemaInference ?? undefined,
    populateOrchestrator: config.populateOrchestrator ?? undefined,
    investigateSubagent: config.investigateSubagent ?? undefined,
    schemaInferenceReasoning: reasoning(
      "schemaInference",
      config.schemaInferenceReasoning,
    ),
    populateOrchestratorReasoning: reasoning(
      "populateOrchestrator",
      config.populateOrchestratorReasoning,
    ),
    investigateSubagentReasoning: reasoning(
      "investigateSubagent",
      config.investigateSubagentReasoning,
    ),
  });
}

export interface ResolvedModelRole {
  model: string;
  reasoning: ReasoningLevel;
  /** True when `reasoning` came from the user rather than the provider default. */
  reasoningOverridden: boolean;
}

export type ResolvedModelConfig = Record<ModelRoleKey, ResolvedModelRole>;

export async function getModelConfig(
  userId: string,
): Promise<ResolvedModelConfig> {
  const llmConfig = await getLlmProviderConfig();
  const config = await convex.query(internal.modelConfig.getInternal, {
    userId,
    provider: llmConfig?.provider ?? "openrouter",
  });

  const roleDefaults: Record<ModelRoleKey, string> = {
    schemaInference: DEFAULT_MODEL_IDS.SCHEMA_INFERENCE,
    populateOrchestrator: DEFAULT_MODEL_IDS.POPULATE_ORCHESTRATOR,
    investigateSubagent: DEFAULT_MODEL_IDS.INVESTIGATE_SUBAGENT,
  };

  const resolve = (role: ModelRoleKey): ResolvedModelRole => {
    const savedReasoning = config?.[`${role}Reasoning`] as string | undefined;
    return {
      model: modelForProvider(
        config?.[role] as string | undefined,
        role,
        roleDefaults[role],
        llmConfig,
      ),
      reasoning: reasoningForProvider(
        savedReasoning,
        role,
        llmConfig?.provider,
      ),
      reasoningOverridden: isReasoningLevel(savedReasoning),
    };
  };

  return {
    schemaInference: resolve("schemaInference"),
    populateOrchestrator: resolve("populateOrchestrator"),
    investigateSubagent: resolve("investigateSubagent"),
  };
}

/**
 * Fetch models from OpenRouter REST API and return parsed models ready
 * for Convex storage.
 */
export async function fetchModelsFromOpenRouter(): Promise<OpenRouterModel[]> {
  const apiKey = await requireOpenRouterApiKey();

  const baseUrl = (
    env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/models`);
  url.searchParams.set("output_modalities", "text");
  url.searchParams.set("supported_parameters", "tools");

  // Only text-based models that support tools
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { completion?: string; prompt?: string };
    }>;
  };

  // Filter excluded and map to OpenRouterModel
  // Prices from OpenRouter are per-token; multiply by 1M for per-million
  const models = json.data
    .filter((m) => !EXCLUDED_MODEL_SLUGS.includes(m.id))
    .map((model) => ({
      modelName: model.name ?? model.id,
      canonicalSlug: model.id,
      contextLength: model.context_length ?? 0,
      promptCost: parseFloat(model.pricing?.prompt ?? "0") * 1_000_000,
      completionCost: parseFloat(model.pricing?.completion ?? "0") * 1_000_000,
    }));

  return models;
}
