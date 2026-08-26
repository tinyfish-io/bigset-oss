import { convex, internal } from "./convex.js";
import { env } from "./env.js";
import { FETCH_TIMEOUT_MS } from "./fetch-timeout.js";
import {
  getKeychainCredential,
  setKeychainCredential,
} from "./local-keychain-client.js";
import {
  LLM_PROVIDER_TYPES,
  defaultBaseUrlForLlmProvider,
  defaultModelForLlmProvider,
  isLlmProviderType,
  llmProviderLabel,
  normalizeLlmProviderInput,
  type LlmProviderConfig,
  type LlmProviderInput,
  type LlmProviderType,
} from "./config/llm.js";
import type {
  ConnectionMethod,
  LocalCredentialService,
} from "./local-credential-types.js";

export const LOCAL_USER_ID = "local_user_default";

export interface ServiceSetupStatus {
  configured: boolean;
  source: "local" | "env" | null;
  connectionMethod: ConnectionMethod | null;
  verifiedAt: number | null;
  provider?: LlmProviderType;
  providerLabel?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface LocalSetupStatus {
  mode: "local" | "production";
  required: boolean;
  complete: boolean;
  services: {
    tinyfish: ServiceSetupStatus;
    llm: ServiceSetupStatus;
    llmProviders?: Record<LlmProviderType, ServiceSetupStatus>;
    /** Deprecated compatibility alias for older UI code. */
    openrouter?: ServiceSetupStatus;
  };
}

function isPlaceholder(value: string, service: LocalCredentialService): boolean {
  if (!value.trim()) return true;
  if (value.includes("...")) return true;
  if (service === "openrouter" && value === "sk-or-...") return true;
  return false;
}

function envCredential(service: LocalCredentialService): string | undefined {
  const value =
    service === "tinyfish"
      ? process.env.TINYFISH_API_KEY
      : service === "openrouter"
        ? env.OPENROUTER_API_KEY
        : undefined;
  if (!value || isPlaceholder(value, service)) return undefined;
  return value;
}

function llmProviderService(provider: LlmProviderType): LocalCredentialService {
  return provider;
}

async function localCredential(service: LocalCredentialService): Promise<{
  apiKey: string;
  connectionMethod: ConnectionMethod;
  verifiedAt: number | null;
  keychainAccount: string;
  llmProvider?: LlmProviderType;
  llmBaseUrl?: string;
  llmDefaultModel?: string;
} | null> {
  if (!env.IS_LOCAL_MODE) return null;

  const row = await convex.query(internal.localCredentials.getInternal, {
    service,
  });
  const rowData = row as
    | {
        keychainAccount?: string;
        connectionMethod?: ConnectionMethod;
        verifiedAt?: number;
        llmProvider?: unknown;
        llmBaseUrl?: unknown;
        llmDefaultModel?: unknown;
      }
    | null;

  const rowProvider = isLlmProviderType(rowData?.llmProvider)
    ? rowData.llmProvider
    : undefined;
  const rowBaseUrl =
    typeof rowData?.llmBaseUrl === "string" ? rowData.llmBaseUrl : undefined;
  const keychain = await getKeychainCredential(service);
  if (
    rowProvider &&
    service === rowProvider &&
    ["custom", "ollama", "lmstudio"].includes(rowProvider) &&
    rowBaseUrl
  ) {
    return {
      apiKey: keychain?.apiKey ?? "",
      connectionMethod: rowData?.connectionMethod ?? "api_key",
      verifiedAt: rowData?.verifiedAt ?? null,
      keychainAccount:
        keychain?.keychainAccount ?? rowData?.keychainAccount ?? "",
      llmProvider: rowProvider,
      llmBaseUrl: rowBaseUrl,
      llmDefaultModel:
        typeof rowData?.llmDefaultModel === "string"
          ? rowData.llmDefaultModel
          : undefined,
    };
  }

  if (!keychain?.apiKey) {
    return null;
  }

  return {
    apiKey: keychain.apiKey,
    connectionMethod: rowData?.connectionMethod ?? "api_key",
    verifiedAt: rowData?.verifiedAt ?? null,
    keychainAccount: keychain.keychainAccount,
    llmProvider: isLlmProviderType(rowData?.llmProvider)
      ? rowData.llmProvider
      : undefined,
    llmBaseUrl:
      typeof rowData?.llmBaseUrl === "string" ? rowData.llmBaseUrl : undefined,
    llmDefaultModel:
      typeof rowData?.llmDefaultModel === "string"
        ? rowData.llmDefaultModel
        : undefined,
  };
}

async function localCredentialForStatus(
  service: LocalCredentialService,
): Promise<Awaited<ReturnType<typeof localCredential>>> {
  try {
    return await localCredential(service);
  } catch {
    return null;
  }
}

async function activeLlmProviderForStatus(): Promise<LlmProviderType> {
  if (!env.IS_LOCAL_MODE) return "openrouter";

  try {
    const active = await convex.query(internal.localCredentials.getInternal, {
      service: "llm",
    });
    const activeProvider = (active as { llmProvider?: unknown } | null)
      ?.llmProvider;
    if (isLlmProviderType(activeProvider)) return activeProvider;
  } catch {
    // Convex functions may be one push behind during local development. Fall
    // back instead of making every backend status/settings route return 500.
  }

  const legacy = await localCredentialForStatus("openrouter");
  if (legacy?.llmProvider) return legacy.llmProvider;
  return "openrouter";
}

async function localCredentialForLlmProvider(
  provider: LlmProviderType,
): Promise<Awaited<ReturnType<typeof localCredential>>> {
  const direct = await localCredentialForStatus(llmProviderService(provider));
  if (direct && (!direct.llmProvider || direct.llmProvider === provider)) {
    return direct;
  }

  if (provider !== "openrouter") {
    const legacy = await localCredentialForStatus("openrouter");
    if (legacy?.llmProvider === provider) return legacy;
  }

  return null;
}

export async function setActiveLocalLlmProvider(
  provider: LlmProviderType,
): Promise<void> {
  if (!env.IS_LOCAL_MODE) {
    throw new Error("Local credential storage is disabled when PROD=1.");
  }

  await convex.mutation(internal.localCredentials.upsertInternal, {
    service: "llm",
    connectionMethod: "api_key",
    verifiedAt: Date.now(),
    llmProvider: provider,
  });
}

export async function resolveCredential(
  service: LocalCredentialService,
): Promise<{ apiKey: string; source: "local" | "env" } | null> {
  if (env.IS_LOCAL_MODE) {
    const local = await localCredential(service);
    return local ? { apiKey: local.apiKey, source: "local" } : null;
  }

  const fromEnv = envCredential(service);
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  return null;
}

export async function getLlmProviderConfig(): Promise<LlmProviderConfig | null> {
  if (env.IS_LOCAL_MODE) {
    const provider = await activeLlmProviderForStatus();
    const local = await localCredentialForLlmProvider(provider);
    if (!local) return null;

    return normalizeLlmProviderInput(
      {
        provider,
        apiKey: local.apiKey,
        baseUrl:
          local.llmBaseUrl ?? defaultBaseUrlForLlmProvider(provider),
        defaultModel:
          local.llmDefaultModel || defaultModelForLlmProvider(provider),
      },
      "local",
    );
  }

  const apiKey = envCredential("openrouter");
  if (!apiKey) return null;
  return normalizeLlmProviderInput(
    {
      provider: "openrouter",
      apiKey,
      baseUrl: env.OPENROUTER_BASE_URL,
      defaultModel: env.SCHEMA_INFERENCE_MODEL,
    },
    "env",
  );
}

export async function requireLlmProviderConfig(): Promise<LlmProviderConfig> {
  const config = await getLlmProviderConfig();
  if (!config) {
    throw new Error("LLM provider is not configured. Complete local setup first.");
  }
  return config;
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const config = await getLlmProviderConfig();
  return config?.provider === "openrouter" ? config.apiKey : undefined;
}

export async function requireOpenRouterApiKey(): Promise<string> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter is not configured as the current LLM provider.");
  }
  return apiKey;
}

export async function getTinyFishApiKey(): Promise<string | undefined> {
  return (await resolveCredential("tinyfish"))?.apiKey;
}

export function tinyFishHeaders(apiKey: string): Record<string, string> {
  return {
    "X-API-Key": apiKey,
    "X-TF-ORIGIN": "BigSet",
    "X-TF-Request-Origin": "BigSet",
  };
}

async function withFetchTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requireLocalSetupComplete(): Promise<void> {
  if (!env.IS_LOCAL_MODE) return;
  const status = await getLocalSetupStatus();
  if (!status.complete) {
    throw new Error("Local setup is incomplete.");
  }
}

export async function getLocalSetupStatus(): Promise<LocalSetupStatus> {
  if (!env.IS_LOCAL_MODE) {
    const tinyfish = envCredential("tinyfish");
    const llmConfig = await getLlmProviderConfig();
    const llm: ServiceSetupStatus = llmConfig
      ? {
          configured: true,
          source: llmConfig.source,
          connectionMethod: "api_key",
          verifiedAt: null,
          provider: llmConfig.provider,
          providerLabel: llmProviderLabel(llmConfig.provider),
          baseUrl: llmConfig.baseUrl,
          defaultModel: llmConfig.defaultModel,
        }
      : {
          configured: false,
          source: null,
          connectionMethod: null,
          verifiedAt: null,
        };
    return {
      mode: "production",
      required: false,
      complete: true,
      services: {
        tinyfish: {
          configured: !!tinyfish,
          source: tinyfish ? "env" : null,
          connectionMethod: tinyfish ? "api_key" : null,
          verifiedAt: null,
        },
        llm,
        openrouter: llm,
      },
    };
  }

  const tinyfishLocal = await localCredentialForStatus("tinyfish");

  const tinyfish: ServiceSetupStatus = tinyfishLocal
    ? {
        configured: true,
        source: "local",
        connectionMethod: tinyfishLocal.connectionMethod,
        verifiedAt: tinyfishLocal.verifiedAt,
      }
    : {
        configured: false,
        source: null,
        connectionMethod: null,
        verifiedAt: null,
      };

  const providerStatusEntries = await Promise.all(
    LLM_PROVIDER_TYPES.map(async (provider) => {
      const credential = await localCredentialForLlmProvider(provider);
      const status: ServiceSetupStatus = credential
      ? {
          configured: true,
          source: "local",
          connectionMethod: credential.connectionMethod,
          verifiedAt: credential.verifiedAt,
          provider,
          providerLabel: llmProviderLabel(provider),
          baseUrl:
            credential.llmBaseUrl ?? defaultBaseUrlForLlmProvider(provider),
          defaultModel:
            credential.llmDefaultModel || defaultModelForLlmProvider(provider),
        }
      : {
          configured: false,
          source: null,
          connectionMethod: null,
          verifiedAt: null,
          provider,
          providerLabel: llmProviderLabel(provider),
          baseUrl: defaultBaseUrlForLlmProvider(provider),
          defaultModel: defaultModelForLlmProvider(provider),
        };
      return [provider, status] as const;
    }),
  );
  const providerStatuses = Object.fromEntries(
    providerStatusEntries,
  ) as Record<LlmProviderType, ServiceSetupStatus>;

  const llmProvider = await activeLlmProviderForStatus();
  const llm = providerStatuses[llmProvider];

  return {
    mode: "local",
    required: true,
    complete: tinyfish.configured && llm.configured,
    services: {
      tinyfish,
      llm,
      llmProviders: providerStatuses,
      openrouter: providerStatuses.openrouter,
    },
  };
}

export async function saveLocalCredential(
  service: LocalCredentialService,
  apiKey: string,
  connectionMethod: ConnectionMethod,
): Promise<void> {
  if (!env.IS_LOCAL_MODE) {
    throw new Error("Local credential storage is disabled when PROD=1.");
  }
  const { keychainAccount } = await setKeychainCredential(service, apiKey);
  await convex.mutation(internal.localCredentials.upsertInternal, {
    service,
    keychainAccount,
    connectionMethod,
    verifiedAt: Date.now(),
    ...(service === "openrouter"
      ? {
          llmProvider: "openrouter" as const,
          llmBaseUrl: defaultBaseUrlForLlmProvider("openrouter"),
          llmDefaultModel: defaultModelForLlmProvider("openrouter"),
        }
      : {}),
  });

  if (service === "openrouter") {
    await setActiveLocalLlmProvider("openrouter");
  }
}

export async function saveLocalLlmProviderConfig(
  input: LlmProviderInput,
  connectionMethod: ConnectionMethod = "api_key",
): Promise<LlmProviderConfig> {
  if (!env.IS_LOCAL_MODE) {
    throw new Error("Local credential storage is disabled when PROD=1.");
  }

  const config = normalizeLlmProviderInput(input, "local");
  const keychainAccount = config.apiKey
    ? (
        await setKeychainCredential(
          llmProviderService(config.provider),
          config.apiKey,
        )
      ).keychainAccount
    : undefined;
  await convex.mutation(internal.localCredentials.upsertInternal, {
    service: llmProviderService(config.provider),
    ...(keychainAccount ? { keychainAccount } : {}),
    connectionMethod,
    verifiedAt: Date.now(),
    llmProvider: config.provider,
    llmBaseUrl: config.baseUrl,
    llmDefaultModel: config.defaultModel,
  });
  await setActiveLocalLlmProvider(config.provider);
  return config;
}

export async function clearLegacyPlaintextLocalCredentials(): Promise<void> {
  if (!env.IS_LOCAL_MODE) return;
  await convex.mutation(internal.localCredentials.clearLegacyPlaintextInternal, {});
}

export async function verifyTinyFishApiKey(apiKey: string): Promise<void> {
  const url = new URL("https://api.search.tinyfish.ai");
  url.searchParams.set("query", "BigSet");

  await withFetchTimeout(
    async (signal) => {
      const response = await fetch(url, {
        headers: tinyFishHeaders(apiKey),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("TinyFish rejected that API key.");
        }
        throw new Error(
          `TinyFish verification failed with HTTP ${response.status}.`,
        );
      }
    },
    `TinyFish verification timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
  );
}

export async function verifyOpenRouterApiKey(apiKey: string): Promise<void> {
  const baseUrl = (
    env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");

  await withFetchTimeout(
    async (signal) => {
      const response = await fetch(`${baseUrl}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("OpenRouter rejected that API key.");
        }
        throw new Error(
          `OpenRouter verification failed with HTTP ${response.status}.`,
        );
      }
    },
    `OpenRouter verification timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
  );
}

export async function exchangeOpenRouterOAuthCode({
  code,
  codeVerifier,
}: {
  code: string;
  codeVerifier: string;
}): Promise<string> {
  return await withFetchTimeout(
    async (signal) => {
      const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          code_challenge_method: "S256",
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter OAuth exchange failed with HTTP ${response.status}.`,
        );
      }

      const body = (await response.json()) as { key?: string };
      if (!body.key) {
        throw new Error("OpenRouter OAuth exchange did not return an API key.");
      }
      return body.key;
    },
    `OpenRouter OAuth exchange timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
  );
}
