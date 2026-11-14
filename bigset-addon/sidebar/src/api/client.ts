/**
 * Thin client over `google.script.run` for the sidebar. Apps Script can't
 * make HTTP calls directly from the iframe, but the server-side
 * (src/index.ts in the Apps Script project) can via UrlFetchApp.fetch().
 *
 * Every method here returns a Promise that resolves with whatever the
 * Apps Script server function returned, or rejects with an Error whose
 * message contains the backend's error string.
 *
 * For Svelte code:
 *   import { api } from "../api/client";
 *   const rows = await api.listRows(datasetId);
 *
 * The runtime also exposes `invoke(name, payload)` for one-off server
 * functions (useful for testing or new endpoints).
 */
export interface BackendError {
  error: string;
  details?: Record<string, unknown>;
}

function isBackendError(value: unknown): value is BackendError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

export interface DatasetSummary {
  id: string;
  name: string;
  status: "live" | "building" | "updating" | "failed" | "paused";
  rowCount: number;
  columns: Array<{ name: string; type: string; description?: string; isPrimaryKey?: boolean }>;
  description?: string;
  lastStatusError?: string;
}

export type ColumnType = "text" | "number" | "boolean" | "url" | "date";

export interface DatasetSchema {
  dataset_name: string;
  description: string;
  columns: Array<{
    name: string;
    display_name: string;
    type: string;
    retrieval_hint?: string;
    is_primary_key?: boolean;
  }>;
  primary_key?: string;
  retrieval_strategy?: "search_fetch" | "browser" | "hybrid";
  source_hint?: string;
}

export interface DatasetRow {
  _id: string;
  data: Record<string, unknown>;
  rowSummary?: string;
  howFound?: string;
  sources?: string[];
}

export interface InsertRowsResult {
  rowsInserted: number;
  startCell: string;
  endCell: string;
}

interface ServerApi {
  callBackend<T = unknown>(path: string, method: string, body: unknown): Promise<T>;
  getApiKey(): Promise<string>;
  setApiKey(key: string): Promise<void>;
  getBackendUrl(): Promise<string>;
  setBackendUrl(url: string): Promise<void>;
  insertRowsIntoActiveSheet(
    headers: string[],
    rows: Array<Record<string, unknown>>,
    clearFirst: boolean,
  ): Promise<InsertRowsResult>;
}

function invoke<T>(name: keyof ServerApi, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.script?.run) {
      reject(new Error("Not running inside Google Apps Script (google.script.run unavailable)."));
      return;
    }
    const runner = google.script.run
      .withSuccessHandler((value: T) => resolve(value))
      .withFailureHandler((err: Error | string) => {
        const message =
          typeof err === "string"
            ? err
            : err?.message || "Apps Script call failed";
        reject(new Error(message));
      });
    const fn = runner[name] as (...a: unknown[]) => unknown;
    if (typeof fn !== "function") {
      reject(new Error(`Server function "${String(name)}" is not available`));
      return;
    }
    fn(...args);
  });
}

export const api = {
  /** Call any backend HTTP route. */
  callBackend<T = unknown>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "POST", body: unknown = null): Promise<T> {
    return invoke<T>("callBackend", path, method, body).then((result) => {
      if (isBackendError(result)) {
        throw new Error(result.error);
      }
      return result as T;
    });
  },

  getApiKey: () => invoke<string>("getApiKey"),
  setApiKey: (key: string) => invoke<void>("setApiKey", key),
  getBackendUrl: () => invoke<string>("getBackendUrl"),
  setBackendUrl: (url: string) => invoke<void>("setBackendUrl", url),

  /** Insert rows into the active Google Sheet. */
  insertRows: (headers: string[], rows: Array<Record<string, unknown>>, clearFirst = true) =>
    invoke<InsertRowsResult>("insertRowsIntoActiveSheet", headers, rows, clearFirst),

  /** High-level helpers wrapping the backend endpoints. */
  inferSchema(prompt: string) {
    return this.callBackend<DatasetSchema>("/infer-schema", "POST", { prompt });
  },

  createDataset(schema: {
    name: string;
    description: string;
    columns: Array<{ name: string; type: ColumnType; description?: string; isPrimaryKey?: boolean }>;
    retrievalStrategy?: "search_fetch" | "browser" | "hybrid";
    sourceHint?: string;
    maxRowCount: number;
    refreshCadence?: "manual" | "30m" | "6h" | "12h" | "daily" | "weekly";
  }) {
    return this.callBackend<{ dataset: DatasetSummary & { _id: string } }>("/addon/datasets", "POST", schema).then(
      (r) => ({ ...r.dataset, id: r.dataset._id }),
    );
  },

  populate(
    datasetId: string,
    datasetName: string,
    description: string,
    maxRowCount: number,
    columns: Array<{ name: string; type: ColumnType; description?: string; isPrimaryKey?: boolean }>,
  ) {
    return this.callBackend<{ success: boolean; runId: string }>("/populate", "POST", {
      datasetId,
      datasetName,
      description,
      maxRowCount,
      columns,
    });
  },

  getDataset(id: string) {
    return this.callBackend<{ dataset: DatasetSummary & { _id: string } }>(`/addon/datasets/${encodeURIComponent(id)}`, "GET").then(
      (r) => ({ ...r.dataset, id: r.dataset._id }),
    );
  },

  listRows(id: string) {
    return this.callBackend<{ rows: DatasetRow[]; dataset: DatasetSummary & { _id: string } }>(
      `/addon/datasets/${encodeURIComponent(id)}/rows`,
      "GET",
    ).then((r) => ({ rows: r.rows, dataset: { ...r.dataset, id: r.dataset._id } }));
  },

  stopDataset(id: string) {
    return this.callBackend<{ success: boolean }>("/stop", "POST", { datasetId: id });
  },

  listDatasets() {
    return this.callBackend<{ datasets: Array<DatasetSummary & { _id: string }> }>("/addon/datasets", "GET").then(
      (r) => r.datasets.map((d) => ({ ...d, id: d._id })),
    );
  },

  listPublicDatasets() {
    return this.callBackend<{ datasets: Array<DatasetSummary & { _id: string }> }>("/addon/datasets/public", "GET").then(
      (r) => r.datasets.map((d) => ({ ...d, id: d._id })),
    );
  },

  listPublicRows(datasetId: string) {
    return this.callBackend<{ rows: DatasetRow[]; dataset: DatasetSummary & { _id: string } }>(
      `/addon/datasets/public/${encodeURIComponent(datasetId)}/rows`,
      "GET",
    ).then((r) => ({ rows: r.rows, dataset: { ...r.dataset, id: r.dataset._id } }));
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Data Enrichment API
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Enrich rows directly from sheet data.
   * This is the independent enrichment that doesn't require a BigSet dataset.
   */
  enrichRows(params: {
    sourceColumns: string[];
    targetColumns: string[];
    rows: Array<{
      rowIndex: number;
      sourceData: Record<string, unknown>;
      targetColumns?: string[];
    }>;
  }) {
    return this.callBackend<{
      results: Array<{
        rowIndex: number;
        values: Record<string, unknown>;
        error?: string;
      }>;
      stats: {
        rowsProcessed: number;
        rowsEnriched: number;
        rowsWithErrors: number;
      };
    }>("/sheets/enrich", "POST", {
      sourceColumns: params.sourceColumns,
      targetColumns: params.targetColumns,
      rows: params.rows,
    });
  },
};

/** Where in the Svelte app we are. Useful for the route guard. */
export const ROUTES = ["/", "/settings"] as const;
export type Route = (typeof ROUTES)[number];
