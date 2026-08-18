import { convex, internal } from "./convex.js";
import { env } from "./env.js";
import { FETCH_TIMEOUT_MS } from "./fetch-timeout.js";
import {
  getKeychainCredential,
  setKeychainCredential,
} from "./local-keychain-client.js";
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
}

export interface LocalSetupStatus {
  mode: "local" | "production";
  required: boolean;
  complete: boolean;
  services: Record<LocalCredentialService, ServiceSetupStatus>;
}

function isPlaceholder(value: string, service: LocalCredentialService): boolean {
  if (!value.trim()) return true;
  if (value.includes("...")) return true;
  if (service === "openrouter" && value === "sk-or-...") return true;
  return false;
}

function envCredential(service: LocalCredentialService): string | undefined {
  const value =
    service === "tinyfish" ? process.env.TINYFISH_API_KEY : env.OPENROUTER_API_KEY;
  if (!value || isPlaceholder(value, service)) return undefined;
  return value;
}

async function localCredential(service: LocalCredentialService): Promise<{
  apiKey: string;
  connectionMethod: ConnectionMethod;
  verifiedAt: number | null;
  keychainAccount: string;
} | null> {
  if (!env.IS_LOCAL_MODE) return null;
  const keychain = await getKeychainCredential(service);
  if (!keychain?.apiKey) return null;

  const row = await convex.query(internal.localCredentials.getInternal, {
    service,
  });

  return {
    apiKey: keychain.apiKey,
    connectionMethod: row?.connectionMethod ?? "api_key",
    verifiedAt: row?.verifiedAt ?? null,
    keychainAccount: keychain.keychainAccount,
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

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  return (await resolveCredential("openrouter"))?.apiKey;
}

export async function requireOpenRouterApiKey(): Promise<string> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter is not configured. Complete local setup first.");
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
    const openrouter = envCredential("openrouter");
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
        openrouter: {
          configured: !!openrouter,
          source: openrouter ? "env" : null,
          connectionMethod: openrouter ? "api_key" : null,
          verifiedAt: null,
        },
      },
    };
  }

  const tinyfishLocal = await localCredentialForStatus("tinyfish");
  const openrouterLocal = await localCredentialForStatus("openrouter");

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

  const openrouter: ServiceSetupStatus = openrouterLocal
    ? {
        configured: true,
        source: "local",
        connectionMethod: openrouterLocal.connectionMethod,
        verifiedAt: openrouterLocal.verifiedAt,
      }
    : {
        configured: false,
        source: null,
        connectionMethod: null,
        verifiedAt: null,
      };

  return {
    mode: "local",
    required: true,
    complete: tinyfish.configured && openrouter.configured,
    services: { tinyfish, openrouter },
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
  });
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
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");

  await withFetchTimeout(
    async (signal) => {
      let response = await fetch(`${baseUrl}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });

      // OpenAI-compatible gateways that don't implement OpenRouter's `/key`
      // endpoint (e.g. OrcaRouter) can still be verified with a lightweight
      // authenticated request — `/models` returns 401 for invalid keys.
      if (response.status === 404) {
        response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        });
      }

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
