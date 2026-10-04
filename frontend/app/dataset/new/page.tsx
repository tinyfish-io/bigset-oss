"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EVENTS, track } from "@/lib/analytics";
import { inferSchema, type InferredColumn } from "@/lib/backend";
import { useAppAuth, useAppConvexAuth } from "@/lib/app-auth";
import {
  REFRESH_CADENCE_OPTIONS,
  type RefreshCadence,
} from "@/lib/refresh-cadence";


type ColumnType = "text" | "number" | "boolean" | "url" | "date";

interface ProposedColumn {
  id: string;
  name: string;
  type: ColumnType;
  description: string;
  isPrimaryKey: boolean;
}

type Step = "describe" | "generating" | "review";

const COLUMN_TYPES: { value: ColumnType; label: string; icon: string }[] = [
  { value: "text", label: "Text", icon: "≡" },
  { value: "number", label: "Number", icon: "#" },
  { value: "boolean", label: "Boolean", icon: "■" },
  { value: "url", label: "URL", icon: "⇗" },
  { value: "date", label: "Date", icon: "☆" },
];

const BACKEND_TYPE_MAP: Record<InferredColumn["type"], ColumnType> = {
  string: "text",
  enum: "text",
  url: "url",
  date: "date",
  number: "number",
  boolean: "boolean",
};

const DEFAULT_MAX_ROW_COUNT = 100;

function mapBackendColumn(col: InferredColumn, index: number): ProposedColumn {
  return {
    id: String(index + 1),
    name: col.display_name,
    type: BACKEND_TYPE_MAP[col.type],
    description: col.retrieval_hint,
    isPrimaryKey: col.is_primary_key,
  };
}

function TypeSelector({ value, onChange }: { value: ColumnType; onChange: (v: ColumnType) => void }) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ColumnType)}
        className="w-full appearance-none rounded border border-border bg-surface pl-2 pr-8 py-1 text-xs outline-none focus:border-foreground/30 cursor-pointer"
      >
        {COLUMN_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.icon} {t.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5l3 3 3-3" />
      </svg>
    </div>
  );
}

export default function NewDatasetPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAppConvexAuth();

  const [step, setStep] = useState<Step>("describe");
  const [prompt, setPrompt] = useState("");
  const [refreshCadence, setRefreshCadence] = useState<RefreshCadence>("daily");
  const [maxRowCountInput, setMaxRowCountInput] = useState(
    String(DEFAULT_MAX_ROW_COUNT),
  );
  const [columns, setColumns] = useState<ProposedColumn[]>([]);
  const [datasetName, setDatasetName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrievalStrategy, setRetrievalStrategy] = useState<
    "search_fetch" | "browser" | "hybrid" | null
  >(null);
  const [sourceHint, setSourceHint] = useState("");
  const { getToken } = useAppAuth();

  const createDataset = useMutation(api.datasets.create);
  const usage = useQuery(
    api.quota.getMy,
    isAuthenticated ? {} : "skip",
  );

  // Page-view event: fires once when the wizard becomes visible (after
  // auth resolves and the user is authenticated; we don't want to fire
  // for unauth visitors who'll be redirected to /sign-in).
  const startFired = useRef(false);
  useEffect(() => {
    if (!startFired.current && !isLoading && isAuthenticated) {
      startFired.current = true;
      track(EVENTS.DATASET_CREATION_STARTED);
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setError(null);
    setStep("generating");

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const schema = await inferSchema(prompt.trim(), token);

      setColumns(schema.columns.map(mapBackendColumn));
      setDatasetName(
        schema.dataset_name
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      );
      setRetrievalStrategy(schema.retrieval_strategy);
      setSourceHint(schema.source_hint);
      track(EVENTS.DATASET_SCHEMA_GENERATED, {
        column_count: schema.columns.length,
      });
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("describe");
    }
  }

  function handleUpdateColumn(id: string, field: "name" | "type" | "description", value: string) {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  function handleRemoveColumn(id: string) {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  }

  function handleAddColumn() {
    setColumns((prev) => [
      ...prev,
      { id: String(Date.now()), name: "New Column", type: "text", description: "", isPrimaryKey: false },
    ]);
  }

  async function handleConfirm() {
    if (isCreating) return;
    const maxRowCount = Number(maxRowCountInput);
    if (!Number.isInteger(maxRowCount) || maxRowCount < 1) {
      setError("Max rows must be a whole number greater than 0.");
      return;
    }
    if (usage && maxRowCount > usage.remaining) {
      setError(
        `Max rows cannot exceed your remaining monthly quota of ${usage.remaining.toLocaleString()} row operations.`,
      );
      return;
    }
    const trimmedDatasetName = datasetName.trim();
    if (!trimmedDatasetName) {
      setError("Dataset name is required.");
      return;
    }
    if (columns.length === 0) {
      setError("Add at least one column before creating the dataset.");
      return;
    }
    setIsCreating(true);
    setError(null);
    let datasetId: string;
    try {
      datasetId = await createDataset({
        name: trimmedDatasetName,
        description: prompt,
        refreshCadence,
        maxRowCount,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description || undefined,
          isPrimaryKey: c.isPrimaryKey || undefined,
        })),
        retrievalStrategy: retrievalStrategy ?? undefined,
        sourceHint: sourceHint || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create dataset";
      setError(
        message.includes("quota exceeded")
          ? "You've used all of this month's free-tier quota. New datasets will be available again at the start of next month."
          : message,
      );
      setIsCreating(false);
      return;
    }
    try {
      track(EVENTS.DATASET_CREATED, {
        datasetId,
        column_count: columns.length,
        refreshCadence,
        maxRowCount,
      });
    } catch {}
    router.push(`/dataset/${datasetId}`);
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border px-5 py-3 flex items-center justify-between bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="hover:opacity-80 transition-opacity">
            <img src="/BigSetLogo.png" alt="BigSet" className="h-[26px] dark:hidden" />
            <img src="/BigSetLogoDarkBG.png" alt="BigSet" className="h-[26px] hidden dark:block" />
          </Link>
          <span className="text-foreground/15">/</span>
          <h1 className="text-sm font-semibold tracking-tight">New Dataset</h1>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          {step === "describe" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-[28px] font-bold tracking-tight leading-none">
                  Create a new dataset
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Describe what data you want to collect. Our agents will figure out the schema; you can start populating it from the dataset page.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium">What do you want to track?</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. YC companies that are currently hiring engineers, with their funding stage, location, and number of open roles"
                  rows={4}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted/50 focus:border-foreground/30 transition-colors resize-none"
                />
              </div>

              {error && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="rounded-lg border border-accent bg-accent px-6 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                Generate Schema
              </button>
            </div>
          )}

          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-20 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
                <span className="text-sm font-medium">Analyzing your request...</span>
              </div>
              <div className="space-y-2 text-center">
                <p className="text-xs text-muted">Figuring out what columns and data sources to use</p>
                <p className="text-xs text-muted/60 max-w-sm">&ldquo;{prompt}&rdquo;</p>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[28px] font-bold tracking-tight leading-none">
                  Review your schema
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Edit column names, types, or remove ones you don&apos;t need.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Dataset name</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={datasetName}
                      onChange={(e) => setDatasetName(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground/30 transition-colors"
                    />
                    <div className="group absolute -bottom-3 right-2 z-10">
                      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 shadow-sm cursor-default transition-all duration-200 group-hover:rounded-xl group-hover:px-4 group-hover:py-3 group-hover:shadow-lg">
                        <svg className="h-3 w-3 text-muted shrink-0" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1C4.136 1 1 3.636 1 7c0 1.511.617 2.897 1.636 3.986-.076.71-.396 1.37-.882 1.876a.5.5 0 00.356.852c1.494 0 2.737-.575 3.573-1.206C6.425 12.83 7.19 13 8 13c3.864 0 7-2.636 7-6s-3.136-6-7-6z" />
                        </svg>
                        <span className="text-[11px] font-medium text-muted whitespace-nowrap group-hover:hidden">My Prompt...</span>
                        <div className="hidden group-hover:block max-w-sm">
                          <p className="text-[10px] uppercase tracking-wider text-muted font-medium mb-1">Your prompt</p>
                          <p className="text-sm text-foreground/70 leading-relaxed">{prompt}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium">Update frequency</label>
                  <div className="flex flex-wrap gap-2">
                    {REFRESH_CADENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setRefreshCadence(opt.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          refreshCadence === opt.value
                            ? "border-foreground bg-foreground text-accent-text"
                            : "border-border bg-surface text-foreground hover:border-foreground/30"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="max-row-count" className="block text-sm font-medium">
                    Max rows
                  </label>
                  <input
                    id="max-row-count"
                    type="number"
                    min={1}
                    max={usage?.remaining}
                    step={1}
                    value={maxRowCountInput}
                    onChange={(e) => setMaxRowCountInput(e.currentTarget.value)}
                    onBlur={() => {
                      if (!maxRowCountInput.trim()) return;
                      const value = Number(maxRowCountInput);
                      if (Number.isInteger(value) && value >= 1) {
                        setMaxRowCountInput(String(value));
                      }
                    }}
                    className="w-36 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium outline-none focus:border-foreground/30 transition-colors"
                  />
                  {usage && (
                    <p className="text-xs text-muted">
                      Up to {usage.remaining.toLocaleString()} row operations available this month.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium">Columns ({columns.length})</label>

                <div className="rounded-lg border border-border bg-surface divide-y divide-border overflow-hidden">
                  <div className="grid grid-cols-[100px_1fr_1.5fr_32px] gap-3 px-4 py-2 bg-background">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">Type</span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">Name</span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted">Description</span>
                    <span />
                  </div>

                  {columns.map((col) => (
                    <div key={col.id} className="grid grid-cols-[100px_1fr_1.5fr_32px] gap-3 px-4 py-2.5 items-start">
                      <TypeSelector value={col.type} onChange={(v) => handleUpdateColumn(col.id, "type", v)} />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={col.name}
                          onChange={(e) => handleUpdateColumn(col.id, "name", e.target.value)}
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-foreground/30"
                        />
                        {col.isPrimaryKey && (
                          <span
                            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="Primary key — uniquely identifies each row"
                          >
                            PK
                          </span>
                        )}
                      </div>
                      <textarea
                        ref={(el) => {
                          if (el) {
                            el.style.height = "auto";
                            el.style.height = el.scrollHeight + "px";
                          }
                        }}
                        value={col.description}
                        onChange={(e) => {
                          handleUpdateColumn(col.id, "description", e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = e.target.scrollHeight + "px";
                        }}
                        rows={1}
                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground/70 outline-none focus:border-foreground/30 resize-none overflow-hidden"
                        placeholder="Optional description"
                      />
                      <button
                        onClick={() => handleRemoveColumn(col.id)}
                        className="text-muted hover:text-red-600 transition-colors text-center text-sm mt-0.5"
                        title="Remove column"
                      >
                        &times;
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={handleAddColumn}
                    className="w-full px-4 py-2.5 text-sm font-medium text-foreground/50 hover:text-foreground bg-foreground/[0.03] hover:bg-foreground/[0.06] transition-colors text-center"
                  >
                    + New column
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirm}
                  disabled={isCreating}
                  className="rounded-lg border border-accent bg-accent px-6 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? "Creating…" : "Create Dataset"}
                </button>
                <button
                  onClick={() => setStep("describe")}
                  disabled={isCreating}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

    </div>
  );
}
