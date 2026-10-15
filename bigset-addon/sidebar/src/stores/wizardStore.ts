/**
 * Wizard state store. Holds the prompt, generated schema, dataset id,
 * populate progress, and the active step. The wizard has 4 steps:
 *
 *   1. describe    — user enters prompt
 *   2. generating  — calling /infer-schema
 *   3. review      — schema preview + edit + confirm
 *   4. populating  — calling /populate and polling /addon/datasets/:id
 *
 * After step 4 completes successfully, the UI navigates to a "done" view
 * and offers to insert rows into the Sheet.
 */
import { writable, derived, type Writable } from "svelte/store";
import type { DatasetSummary, DatasetRow } from "../api/client.js";

export type Step = "describe" | "generating" | "review" | "populating" | "done";

export type ColumnType = "text" | "number" | "boolean" | "url" | "date";

export interface ColumnDraft {
  name: string;
  type: ColumnType;
  description: string;
  isPrimaryKey: boolean;
}

export interface SchemaDraft {
  name: string;
  description: string;
  primaryKey: string | null;
  retrievalStrategy: "search_fetch" | "browser" | "hybrid" | null;
  sourceHint: string | null;
  columns: ColumnDraft[];
  maxRowCount: number;
}

export interface DatasetSnapshot {
  id: string;
  name: string;
  status: "live" | "building" | "updating" | "failed" | "paused";
  rowCount: number;
  columns: Array<{ name: string; type: ColumnType; description?: string; isPrimaryKey?: boolean }>;
  lastStatusError?: string;
}

export interface WizardState {
  step: Step;
  prompt: string;
  schema: SchemaDraft | null;
  dataset: DatasetSnapshot | null;
  rowCount: number;
  startedAt: number | null;
  error: string | null;
  /** Cached rows from /addon/datasets/:id/rows for insertion into the Sheet. */
  rows: Array<Record<string, unknown>>;
  /** Dataset selected from the Datasets or Public tab for preview/insert. */
  selectedForInsert: { dataset: DatasetSummary; rows: DatasetRow[] } | null;
}

function emptySchema(name = ""): SchemaDraft {
  return {
    name,
    description: "",
    primaryKey: null,
    retrievalStrategy: "search_fetch",
    sourceHint: null,
    columns: [],
    maxRowCount: 100,
  };
}

const initial: WizardState = {
  step: "describe",
  prompt: "",
  schema: null,
  dataset: null,
  rowCount: 0,
  startedAt: null,
  error: null,
  rows: [],
  selectedForInsert: null,
};

export const wizard: Writable<WizardState> = writable(initial);

export function resetWizard(): void {
  wizard.set(initial);
}

export function setStep(step: Step): void {
  wizard.update((s) => ({ ...s, step, error: null }));
}

export function setPrompt(prompt: string): void {
  wizard.update((s) => ({ ...s, prompt }));
}

export function setSchema(schema: SchemaDraft): void {
  wizard.update((s) => ({ ...s, schema }));
}

export function setDataset(dataset: DatasetSnapshot): void {
  wizard.update((s) => ({
    ...s,
    dataset,
    rowCount: dataset.rowCount ?? s.rowCount,
  }));
}

export function setRowCount(n: number): void {
  wizard.update((s) => ({ ...s, rowCount: n }));
}

export function setError(msg: string | null): void {
  wizard.update((s) => ({ ...s, error: msg }));
}

export function setRows(rows: Array<Record<string, unknown>>): void {
  wizard.update((s) => ({ ...s, rows }));
}

export function setPopulating(): void {
  wizard.update((s) => ({
    ...s,
    step: "populating",
    startedAt: Date.now(),
    error: null,
  }));
}

export function setDone(): void {
  wizard.update((s) => ({ ...s, step: "done" }));
}

export function setSelectedForInsert(ds: DatasetSummary, rows: DatasetRow[]): void {
  wizard.update((s) => ({ ...s, selectedForInsert: { dataset: ds, rows } }));
}

export function clearSelectedForInsert(): void {
  wizard.update((s) => ({ ...s, selectedForInsert: null }));
}

export function updateColumn(index: number, patch: Partial<ColumnDraft>): void {
  wizard.update((s) => {
    if (!s.schema) return s;
    const cols = [...s.schema.columns];
    cols[index] = { ...cols[index], ...patch };
    return { ...s, schema: { ...s.schema, columns: cols } };
  });
}

export function removeColumn(index: number): void {
  wizard.update((s) => {
    if (!s.schema) return s;
    const cols = s.schema.columns.filter((_, i) => i !== index);
    const pkStillPresent =
      s.schema.primaryKey !== null &&
      cols.some((c) => c.isPrimaryKey);
    const newPk = pkStillPresent
      ? cols.find((c) => c.isPrimaryKey)?.name ?? null
      : null;
    return { ...s, schema: { ...s.schema, columns: cols, primaryKey: newPk } };
  });
}

export function addColumn(): void {
  wizard.update((s) => {
    if (!s.schema) return s;
    const cols = [
      ...s.schema.columns,
      { name: "", type: "text" as ColumnType, description: "", isPrimaryKey: false },
    ];
    return { ...s, schema: { ...s.schema, columns: cols } };
  });
}

export function updateSchema(patch: Partial<SchemaDraft>): void {
  wizard.update((s) => {
    if (!s.schema) {
      return { ...s, schema: { ...emptySchema(), ...patch } };
    }
    return { ...s, schema: { ...s.schema, ...patch } };
  });
}

/** True if the prompt is non-empty (whitespace-tolerant). */
export const hasPrompt = derived(wizard, ($w) => $w.prompt.trim().length > 0);
