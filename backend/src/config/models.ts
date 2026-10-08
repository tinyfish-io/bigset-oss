/**
 * Backend configuration for AI models.
 *
 * Defines the typed interfaces and constants for OpenRouter model management.
 */

import { api, internal, convex } from "../convex.js";
import { env } from "../env.js";
import { getLlmBaseUrl, requireLlmApiKey } from "../local-credentials.js";

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
 * If the user has no saved config, returns the system defaults from env.
 * Callers always get a complete config — never null.
 */
export async function getModelConfig(
  userId: string
): Promise<{
  schemaInference: string;
  populateOrchestrator: string;
  investigateSubagent: string;
}> {
  const config = await convex.query(internal.modelConfig.getInternal, { userId });
  return {
    schemaInference: config?.schemaInference ?? DEFAULT_MODEL_IDS.SCHEMA_INFERENCE,
    populateOrchestrator: config?.populateOrchestrator ?? DEFAULT_MODEL_IDS.POPULATE_ORCHESTRATOR,
    investigateSubagent: config?.investigateSubagent ?? DEFAULT_MODEL_IDS.INVESTIGATE_SUBAGENT,
  };
}

/**
 * Fetch models from the active LLM gateway (OpenRouter or OrcaRouter) and
 * return parsed models ready for Convex storage.
 */
export async function fetchModelsFromOpenRouter(): Promise<OpenRouterModel[]> {
  const apiKey = await requireLlmApiKey();

  const baseUrl = await getLlmBaseUrl();
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
    throw new Error(`LLM gateway API failed: ${response.status} ${response.statusText}`);
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
