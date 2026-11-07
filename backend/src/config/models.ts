/**
 * Backend configuration for AI models.
 *
 * Models come from OpenRouter (pay per token, needs an API key) or from the
 * user's own Claude / ChatGPT subscription through the Claude Code or Codex
 * CLI (slugs prefixed claude-code/ or codex/; see ../ai/subscriptions.ts).
 */

import { api, internal, convex } from "../convex.js";
import { env } from "../env.js";
import { getOpenRouterApiKey, requireOpenRouterApiKey } from "../local-credentials.js";
import {
  getAllSubscriptionStatuses,
  subscriptionDefaults,
  subscriptionModels,
  type RoleModelSlugs,
  type SubscriptionBackend,
} from "../ai/subscriptions.js";

export interface OpenRouterModel {
  modelName: string;
  canonicalSlug: string;
  contextLength: number;
  completionCost: number;
  promptCost: number;
}

/**
 * Default model slugs for each agent role.
 * Read from environment variables so operators can change defaults
 * without touching code. Falls back to typed literals when env vars
 * are unset (useful for local dev without a .env file).
 */
export const DEFAULT_MODEL_IDS = {
  SCHEMA_INFERENCE: env.SCHEMA_INFERENCE_MODEL,
  POPULATE_ORCHESTRATOR: env.POPULATE_ORCHESTRATOR_MODEL,
  INVESTIGATE_SUBAGENT: env.INVESTIGATE_SUBAGENT_MODEL,
} as const;

export type ModelBackend = "openrouter" | SubscriptionBackend;

export type RoleModels = RoleModelSlugs;

/**
 * Which backend the defaults use when a user has not picked models.
 *
 * BIGSET_MODEL_BACKEND=openrouter|claude-code|codex forces one. Otherwise an
 * OpenRouter key wins (existing setups keep their behavior), then a signed-in
 * Claude Code CLI, then a signed-in Codex CLI.
 */
export async function activeModelBackend(): Promise<ModelBackend> {
  const forced = env.BIGSET_MODEL_BACKEND;
  if (forced === "openrouter" || forced === "claude-code" || forced === "codex") return forced;
  if (forced) console.warn(`[models] ignoring unknown BIGSET_MODEL_BACKEND="${forced}"`);

  if (await getOpenRouterApiKey().catch(() => undefined)) return "openrouter";
  const subscriptions = await getAllSubscriptionStatuses();
  if (subscriptions["claude-code"].available) return "claude-code";
  if (subscriptions.codex.available) return "codex";
  return "openrouter";
}

export async function defaultModelConfig(): Promise<RoleModels> {
  const backend = await activeModelBackend();
  if (backend !== "openrouter") {
    const defaults = await subscriptionDefaults(backend);
    if (defaults) return defaults;
    console.warn(`[models] no default models for ${backend}; falling back to OpenRouter defaults`);
  }
  return {
    schemaInference: DEFAULT_MODEL_IDS.SCHEMA_INFERENCE,
    populateOrchestrator: DEFAULT_MODEL_IDS.POPULATE_ORCHESTRATOR,
    investigateSubagent: DEFAULT_MODEL_IDS.INVESTIGATE_SUBAGENT,
  };
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
 * Every model the user can pick: models of each signed-in subscription CLI,
 * then the cached OpenRouter list. If the OpenRouter cache is empty and a key
 * is configured, fetches from OpenRouter and stores the result in Convex.
 */
export async function getCachedModels(): Promise<OpenRouterModel[]> {
  const subscriptions = await getAllSubscriptionStatuses();
  const signedIn = (Object.keys(subscriptions) as SubscriptionBackend[]).filter(
    (backend) => subscriptions[backend].available,
  );
  const subscriptionList = (await Promise.all(signedIn.map(subscriptionModels))).flat();

  const models = await convex.query(api.openRouterModels.list, {});
  const cached = models as unknown as OpenRouterModel[];
  if (cached.length > 0) return [...subscriptionList, ...cached];

  if (!(await getOpenRouterApiKey().catch(() => undefined))) {
    console.log(
      `[models] OpenRouter not configured; listing ${subscriptionList.length} subscription models only`,
    );
    return subscriptionList;
  }

  const fetched = await fetchModelsFromOpenRouter();
  await upsertModelBatch(fetched);
  return [...subscriptionList, ...fetched];
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
  }
): Promise<void> {
  await convex.mutation(internal.modelConfig.upsertInternal, {
    userId,
    schemaInference: config.schemaInference ?? undefined,
    populateOrchestrator: config.populateOrchestrator ?? undefined,
    investigateSubagent: config.investigateSubagent ?? undefined,
  });
}

/**
 * Fetch the model configuration for a specific user from Convex.
 * Roles the user has not set fall back to defaultModelConfig(), which follows
 * the active backend (OpenRouter or a subscription CLI).
 * Callers always get a complete config — never null.
 */
export async function getModelConfig(userId: string): Promise<RoleModels> {
  const config = await convex.query(internal.modelConfig.getInternal, { userId });
  const needsDefaults =
    !config?.schemaInference || !config?.populateOrchestrator || !config?.investigateSubagent;
  const defaults = needsDefaults ? await defaultModelConfig() : null;
  return {
    schemaInference: config?.schemaInference ?? defaults!.schemaInference,
    populateOrchestrator: config?.populateOrchestrator ?? defaults!.populateOrchestrator,
    investigateSubagent: config?.investigateSubagent ?? defaults!.investigateSubagent,
  };
}

/**
 * Fetch models from OpenRouter REST API and return parsed models ready
 * for Convex storage.
 */
export async function fetchModelsFromOpenRouter(): Promise<OpenRouterModel[]> {
  const apiKey = await requireOpenRouterApiKey();

  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
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
