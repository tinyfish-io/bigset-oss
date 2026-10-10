export interface InferredSchema {
  dataset_name: string;
  description: string;
  columns: InferredColumn[];
  primary_key: string;
  retrieval_strategy: "search_fetch" | "browser" | "hybrid";
  source_hint: string;
}

export interface InferredColumn {
  name: string;
  display_name: string;
  type: "string" | "url" | "date" | "number" | "boolean" | "enum";
  is_primary_key: boolean;
  is_enumerable: boolean;
  retrieval_hint: string;
  nullable: boolean;
}

export interface PopulateColumn {
  name: string;
  type: "text" | "number" | "boolean" | "url" | "date";
  description?: string;
  isPrimaryKey?: boolean;
}

export interface PopulateStartResult {
  success: boolean;
  runId: string;
}

export interface WorkflowResult {
  success: boolean;
  result: unknown;
}

/**
 * The effective model config — always complete, never null.
 * schemaInference / populateOrchestrator / investigateSubagent are always strings
 * (user preference or system default from env).
 */
export interface EffectiveModelConfig {
  schemaInference: string;
  populateOrchestrator: string;
  investigateSubagent: string;
}

/**
 * User's saved model preferences — stores the canonical slug (e.g. "anthropic/claude-sonnet-4.6")
 * for each agent role. Null means no preference saved — backend will use the env default.
 */
export interface SavedModelConfig {
  schemaInference: string | null;
  populateOrchestrator: string | null;
  investigateSubagent: string | null;
}

export interface OpenRouterModel {
  modelName: string;
  canonicalSlug: string;
  contextLength: number;
  completionCost: number;
  promptCost: number;
}

export interface ServiceSetupStatus {
  configured: boolean;
  source: "local" | "env" | null;
  connectionMethod: "api_key" | "oauth" | null;
  verifiedAt: number | null;
}

export interface LocalSetupStatus {
  mode: "local" | "production";
  required: boolean;
  complete: boolean;
  services: {
    tinyfish: ServiceSetupStatus;
    openrouter: ServiceSetupStatus;
  };
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3501";

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error || `Backend error (${res.status})`;
}

export async function getLocalSetupStatus(): Promise<LocalSetupStatus> {
  const res = await fetch(`${BACKEND_URL}/local-setup/status`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  return res.json();
}

export async function saveTinyFishApiKey(
  apiKey: string,
): Promise<LocalSetupStatus> {
  const res = await fetch(`${BACKEND_URL}/local-setup/tinyfish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  return res.json();
}

export async function saveOpenRouterApiKey(
  apiKey: string,
): Promise<LocalSetupStatus> {
  const res = await fetch(`${BACKEND_URL}/local-setup/openrouter-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  return res.json();
}

export async function exchangeOpenRouterOAuth(
  code: string,
  codeVerifier: string,
): Promise<LocalSetupStatus> {
  const res = await fetch(`${BACKEND_URL}/local-setup/openrouter-oauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  return res.json();
}

/**
 * Fetch the current user's effective (resolved) model config from the backend.
 *
 * The backend resolves the authenticated user from the Clerk JWT in the Authorization header
 * and looks up their row in the modelConfig Convex table.
 * If the user has no saved preference, returns the system defaults from env.
 *
 * Always returns a complete config — no nulls, no partials.
 *
 * @param token - Clerk JWT obtained via getToken()
 * Throws if the request fails (network error, 401, 500).
 */
export async function getModelConfig(token: string): Promise<EffectiveModelConfig> {
  const res = await fetch(`${BACKEND_URL}/settings/models`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  const data = await res.json();
  return data.config;
}

/**
 * Save (upsert) one or more of the current user's model preferences.
 *
 * The backend resolves the authenticated user from the Clerk JWT in the Authorization header
 * and does a partial upsert — only the fields provided in the body are updated.
 * Unset fields retain their existing values.
 *
 * @param config - A partial model config. e.g. { schemaInference: "google/gemini-2.0-flash-001" }
 *                Only the roles the user wants to change need to be included.
 * @param token - Clerk JWT obtained via getToken()
 *
 * Throws if the request fails (network error, 401, 500).
 */
export async function saveModelConfig(
  config: Partial<SavedModelConfig>,
  token: string,
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/settings/models`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }
}

/**
 * Fetch the cached list of OpenRouter models from the backend.
 *
 * The backend serves models from the openRouterModels Convex table, which is
 * populated by a prior call to refreshOpenRouterModels(). If the cache is empty,
 * the backend auto-fetches from the OpenRouter API on first call.
 *
 * Returns an array of OpenRouterModel objects sorted by modelName.
 * Throws if the request fails (network error, 500).
 */
export async function getOpenRouterModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(`${BACKEND_URL}/openrouter/models`, {
    method: "GET",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  const data = await res.json();
  return data.models ?? [];
}

/**
 * Refresh the OpenRouter model cache by fetching the latest list from the
 * OpenRouter API and storing it in Convex.
 *
 * This is called when the user clicks "Refresh" in the settings UI to ensure
 * they see the most up-to-date model list and pricing.
 *
 * @param token - Clerk JWT obtained via getToken()
 * Returns the newly fetched model list.
 * Throws if the request fails (network error, 500).
 */
export async function refreshOpenRouterModels(token: string): Promise<OpenRouterModel[]> {
  const res = await fetch(`${BACKEND_URL}/openrouter/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  const data = await res.json();
  return data.models ?? [];
}

export async function inferSchema(
  prompt: string,
  token: string,
): Promise<InferredSchema> {
  const res = await fetch(`${BACKEND_URL}/infer-schema`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}

export async function populate(
  datasetId: string,
  datasetName: string,
  description: string,
  maxRowCount: number,
  columns: PopulateColumn[],
  token: string,
): Promise<PopulateStartResult> {
  const res = await fetch(`${BACKEND_URL}/populate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ datasetId, datasetName, description, maxRowCount, columns }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}

export async function update(
  datasetId: string,
  datasetName: string,
  description: string,
  columns: PopulateColumn[],
  token: string,
  rowIds?: string[],
): Promise<PopulateStartResult> {
  const body: Record<string, unknown> = { datasetId, datasetName, description, columns };
  if (rowIds && rowIds.length > 0) body.rowIds = rowIds;
  const res = await fetch(`${BACKEND_URL}/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedApiKey {
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
}

export async function listApiKeys(token: string): Promise<{ keys: ApiKeyInfo[] }> {
  const res = await fetch(`${BACKEND_URL}/api-keys`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function createApiKey(name: string, token: string): Promise<CreatedApiKey> {
  const res = await fetch(`${BACKEND_URL}/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function revokeApiKey(id: string, token: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api-keys/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function stopPopulation(
  datasetId: string,
  token: string,
): Promise<{ success: boolean }> {
  const res = await fetch(`${BACKEND_URL}/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ datasetId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Backend error (${res.status})`;
    throw new Error(message);
  }

  return res.json();
}
