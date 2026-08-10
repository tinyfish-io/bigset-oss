import { writable, derived } from "svelte/store";

export interface SelectionData {
  headers: string[];
  rows: Array<{ rowIndex: number; data: Record<string, unknown | null> }>;
  range: string;
}

export type EnrichStatus = "idle" | "loading" | "confirm" | "enriching" | "done" | "error";

export interface RowResult {
  rowIndex: number;
  values: Record<string, unknown>;
  error?: string;
}

interface EnrichState {
  status: EnrichStatus;
  headers: string[];
  rows: Array<{ rowIndex: number; data: Record<string, unknown | null> }>;
  sourceColumns: string[];
  targetColumns: string[];
  enrichedCount: number;
  errorCount: number;
  error: string | null;
  range: string;
  results: RowResult[];
}

const initial: EnrichState = {
  status: "idle",
  headers: [],
  rows: [],
  sourceColumns: [],
  targetColumns: [],
  enrichedCount: 0,
  errorCount: 0,
  error: null,
  range: "",
  results: [],
};

function createStore() {
  const { subscribe, set, update } = writable(initial);

  return {
    subscribe,

    reset() {
      set(initial);
    },

    async loadSelection() {
      update((s) => ({ ...s, status: "loading" }));
      try {
        const data: SelectionData = await new Promise((resolve, reject) => {
          if (typeof google === "undefined" || !google.script?.run) {
            reject(new Error("Not running in Google Apps Script"));
            return;
          }
          google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler((e: Error | string) =>
              reject(new Error(typeof e === "string" ? e : e.message))
            )
            .getSelectedRange();
        });

        if (!data.headers.length || !data.rows.length) {
          update((s) => ({
            ...s,
            status: "error",
            error: `Detected range ${data.range || "(none)"} has ${data.headers.length} header(s) and ${data.rows.length} data row(s). Select a range with at least one header row and one data row, then try again.`,
            range: data.range,
          }));
          return;
        }

        const sourceCols: string[] = [];
        const targetCols: string[] = [];
        for (const h of data.headers) {
          const nonEmpty = data.rows.filter((r) => r.data[h] != null && r.data[h] !== "");
          const hasAnyData = nonEmpty.length > 0;
          const hasAnyEmpty = nonEmpty.length < data.rows.length;
          if (hasAnyData) sourceCols.push(h);
          if (hasAnyEmpty) targetCols.push(h);
        }

        update((s) => ({
          ...s,
          status: "confirm",
          headers: data.headers,
          rows: data.rows,
          range: data.range,
          sourceColumns: sourceCols,
          targetColumns: targetCols,
        }));
      } catch (err) {
        update((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Failed to read selection",
        }));
      }
    },

    async enrich() {
      update((s) => ({ ...s, status: "enriching", results: [] }));

      try {
        const state = getState();

        const rowsToSend = state.rows
          .filter((r) =>
            state.targetColumns.some(
              (c) => r.data[c] == null || r.data[c] === ""
            )
          )
          .map((r) => ({
            rowIndex: r.rowIndex,
            sourceData: Object.fromEntries(
              Object.entries(r.data).filter(
                ([k, v]) =>
                  state.sourceColumns.includes(k) &&
                  v != null &&
                  v !== ""
              )
            ),
            targetColumns: state.targetColumns.filter(
              (c) => r.data[c] == null || r.data[c] === ""
            ),
          }));

        const { api } = await import("../api/client.js");
        const resp = await api.enrichRows({
          sourceColumns: state.sourceColumns,
          targetColumns: state.targetColumns,
          rows: rowsToSend,
        });

        const updates: Array<{ rowIndex: number; columnName: string; value: unknown }> = [];
        for (const result of resp.results) {
          if (result.error) continue;
          for (const [col, val] of Object.entries(result.values)) {
            updates.push({ rowIndex: result.rowIndex, columnName: col, value: val });
          }
        }

        if (updates.length > 0) {
          await new Promise<void>((resolve, reject) => {
            if (typeof google === "undefined" || !google.script?.run) {
              reject(new Error("Not running in Google Apps Script"));
              return;
            }
            google.script.run
              .withSuccessHandler(() => resolve())
              .withFailureHandler((e: Error | string) =>
                reject(new Error(typeof e === "string" ? e : e.message))
              )
              .updateSheetCells(updates, state.range);
          });
        }

        update((s) => ({
          ...s,
          status: "done",
          enrichedCount: resp.stats.rowsEnriched,
          errorCount: resp.stats.rowsWithErrors,
          results: resp.results,
        }));
      } catch (err) {
        update((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Enrichment failed",
        }));
      }
    },
  };
}

let _state: EnrichState = initial;

function getState(): EnrichState {
  return _state;
}

export const enrichStore = createStore();

enrichStore.subscribe((s) => {
  _state = s;
});

export const eligibleCount = derived(
  { subscribe: enrichStore.subscribe },
  ($) => {
    if (!$.targetColumns.length) return 0;
    const allEmpty = $.rows.map(
      (r) => $.targetColumns.filter((c) => r.data[c] == null || r.data[c] === "").length
    );
    return allEmpty.reduce((a, b) => a + b, 0);
  }
);
