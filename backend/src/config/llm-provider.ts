/**
 * LLM gateway provider registry.
 *
 * BigSet routes all model calls (schema inference, populate/refresh agents,
 * model listing) through a single OpenAI-compatible gateway. OpenRouter is
 * the default gateway; OrcaRouter (https://www.orcarouter.ai) is a
 * first-class alternative that exposes the same endpoint shape at
 * https://api.orcarouter.ai/v1.
 *
 * Operators can select a gateway with the `LLM_PROVIDER` env var
 * ("openrouter" | "orcarouter"). When unset, the gateway is chosen from the
 * configured credential: an OrcaRouter key wins over an OpenRouter key.
 */

export type LlmProviderId = "openrouter" | "orcarouter";

export interface LlmProvider {
  id: LlmProviderId;
  name: string;
  /** Base URL for the OpenAI-compatible API. */
  baseUrl: string;
  /** Env var holding the API key in production / env-driven setups. */
  keyEnvVar: string;
  /** Env var that explicitly selects this provider via LLM_PROVIDER. */
  envValue: LlmProviderId;
  /** Human-readable label used in setup/status copy. */
  label: string;
  /**
   * Authenticated endpoint used to verify an API key. OpenRouter exposes
   * its key check on /key while OrcaRouter (like most OpenAI-compatible
   * gateways) requires auth on /models.
   */
  keyVerificationPath: string;
}

export const OPENROUTER_PROVIDER: LlmProvider = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  keyEnvVar: "OPENROUTER_API_KEY",
  envValue: "openrouter",
  label: "OpenRouter",
  keyVerificationPath: "/key",
};

export const ORCAROUTER_PROVIDER: LlmProvider = {
  id: "orcarouter",
  name: "OrcaRouter",
  baseUrl: "https://api.orcarouter.ai/v1",
  keyEnvVar: "ORCAROUTER_API_KEY",
  envValue: "orcarouter",
  label: "OrcaRouter",
  keyVerificationPath: "/models",
};

export const LLM_PROVIDERS: LlmProvider[] = [
  OPENROUTER_PROVIDER,
  ORCAROUTER_PROVIDER,
];

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return (
    typeof value === "string" &&
    (value === "openrouter" || value === "orcarouter")
  );
}

export function findLlmProvider(id: unknown): LlmProvider | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

/**
 * Provider selected via the `LLM_PROVIDER` env var, if any. This is the
 * explicit override an operator can set to force a gateway regardless of
 * which credential is present. Falls back to OpenRouter (the default).
 */
export function envSelectedProvider(): LlmProvider {
  const selected = process.env.LLM_PROVIDER;
  return findLlmProvider(selected) ?? OPENROUTER_PROVIDER;
}

/**
 * Base URL for a provider. OpenRouter's endpoint can be overridden with
 * `OPENROUTER_BASE_URL` for self-hosted/compatible gateways (existing
 * behavior); OrcaRouter always uses its public endpoint.
 */
export function providerBaseUrl(provider: LlmProvider): string {
  if (provider.id === "orcarouter") {
    return ORCAROUTER_PROVIDER.baseUrl;
  }
  return (process.env.OPENROUTER_BASE_URL || OPENROUTER_PROVIDER.baseUrl).replace(
    /\/+$/,
    "",
  );
}
