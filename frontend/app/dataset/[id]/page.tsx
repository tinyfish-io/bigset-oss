"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DatasetTable } from "@/components/table";
import { useSelection } from "@/components/table/use-selection";
import { SideSheet, CellDetail } from "@/components/SideSheet";
import type { DatasetColumn } from "@/components/table/types";
import { useTheme } from "@/components/ThemeToggle";
import { StatusBadge } from "@/components/dataset/StatusBadge";
import { downloadCSV, downloadXLSX } from "@/lib/export";
import { populate, update, stopPopulation } from "@/lib/backend";
import { EVENTS, captureException, track } from "@/lib/analytics";
import {
  REFRESH_CADENCE_OPTIONS,
  refreshCadenceLabel,
  type RefreshCadence,
} from "@/lib/refresh-cadence";
import type { ProfileUser } from "@/lib/profile-user";
import { useAppAuth, useAppClerk, useAppConvexAuth, useAppUser } from "@/lib/app-auth";

export default function DatasetPage() {
  const params = useParams();
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated } = useAppConvexAuth();
  const { userId, getToken } = useAppAuth();
  const { user } = useAppUser();
  const { signOut } = useAppClerk();
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [populating, setPopulating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmPopulate, setConfirmPopulate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingRefreshCadence, setSavingRefreshCadence] = useState(false);
  const [savingMaxRowCount, setSavingMaxRowCount] = useState(false);
  const [maxRowCountSaveError, setMaxRowCountSaveError] = useState<string | null>(null);
  const [cellDetail, setCellDetail] = useState<{
    column: DatasetColumn;
    value: unknown;
    sources?: string[];
  } | null>(null);

  const datasetId = params.id as Id<"datasets">;
  const dataset = useQuery(
    api.datasets.get,
    authLoading ? "skip" : { id: datasetId },
  );
  const rows = useQuery(
    api.datasetRows.listByDataset,
    authLoading ? "skip" : { datasetId },
  );
  const updateRefreshSettings = useMutation(api.datasets.updateRefreshSettings);
  const removeDataset = useMutation(api.datasets.remove);
  const updateMaxRowCount = useMutation(api.datasets.updateMaxRowCount);
  const usage = useQuery(
    api.quota.getMy,
    isAuthenticated ? {} : "skip",
  );

  const rowIds = useMemo(() => (rows ?? []).map((r) => r._id), [rows]);
  const selection = useSelection(rowIds);
  const selectedCount = selection.selected.size;

  const handlePopulate = useCallback(async () => {
    if (!dataset || populating || dataset.status === "building") return;
    // A new run is starting — discard any lingering stop-latch from the previous run.
    setStopping(false);
    setPopulating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const startedRun = await populate(
        dataset._id,
        dataset.name,
        dataset.description,
        dataset.maxRowCount ?? 100,
        dataset.columns,
        token,
      );
      track(EVENTS.DATASET_POPULATE_STARTED, {
        datasetId: dataset._id,
        column_count: dataset.columns.length,
        runId: startedRun.runId,
      });
    } catch (err) {
      console.error("[populate] failed", err);
      captureException(err, {
        operation: "dataset_populate",
        datasetId: dataset._id,
      });
    } finally {
      setPopulating(false);
    }
  }, [dataset, populating, getToken]);

  const handleCellExpand = useCallback((columnName: string, value: unknown, rowId: string) => {
    if (!dataset || !rows) return;
    const col = dataset.columns.find((c) => c.name === columnName);
    if (!col) return;
    const row = rows.find((r) => r._id === rowId);
    setCellDetail({ column: col, value, sources: row?.sources });
  }, [dataset, rows]);

  const openedFired = useRef<string | null>(null);
  const autoPopulateFired = useRef<string | null>(null);
  useEffect(() => {
    if (dataset && openedFired.current !== dataset._id) {
      openedFired.current = dataset._id;
      track(EVENTS.DATASET_OPENED, {
        datasetId: dataset._id,
        seedKey: dataset.seedKey,
        visibility: dataset.visibility ?? "private",
        is_owner: userId === dataset.ownerId,
      });
    }
    if (
      dataset &&
      autoPopulateFired.current !== dataset._id &&
      dataset.status === "paused" &&
      (dataset.rowCount ?? 0) === 0 &&
      userId === dataset.ownerId
    ) {
      autoPopulateFired.current = dataset._id;
      handlePopulate();
    }
  }, [dataset, userId, handlePopulate]);

  async function handleExport(format: "csv" | "xlsx") {
    if (!dataset || !rows || exporting) return;

    const exportRows =
      selectedCount > 0
        ? rows.filter((r) => selection.selected.has(r._id))
        : rows;
    if (exportRows.length === 0) return;

    setExporting(format);
    try {
      if (format === "csv") {
        downloadCSV(dataset.name, dataset.columns, exportRows);
      } else {
        await downloadXLSX(dataset.name, dataset.columns, exportRows);
      }
      track(EVENTS.DATASET_EXPORTED, {
        format,
        row_count: exportRows.length,
        total_rows: rows.length,
        selected_only: selectedCount > 0,
        seedKey: dataset.seedKey,
      });
    } catch (err) {
      console.error("[export] failed", err);
      captureException(err, {
        operation: "dataset_export",
        format,
        datasetId: dataset._id,
        row_count: exportRows.length,
        selected_only: selectedCount > 0,
      });
    } finally {
      setExporting(null);
    }
  }

  async function handleUpdate() {
    if (!dataset || updating || dataset.status === "building" || dataset.status === "updating") return;
    // A new run is starting — discard any lingering stop-latch from the previous run.
    setStopping(false);
    setUpdating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const selectedRowIds = selectedCount > 0 ? Array.from(selection.selected) : undefined;
      const result = await update(
        dataset._id,
        dataset.name,
        dataset.description,
        dataset.columns,
        token,
        selectedRowIds,
      );
      if (selectedCount > 0) selection.clear();
      track(EVENTS.DATASET_UPDATE_STARTED, {
        datasetId: dataset._id,
        column_count: dataset.columns.length,
        row_count: selectedRowIds?.length ?? rows?.length ?? 0,
        selective: selectedCount > 0,
        runId: result.runId,
      });
    } catch (err) {
      console.error("[update] failed", err);
      captureException(err, {
        operation: "dataset_update",
        datasetId: dataset._id,
      });
    } finally {
      setUpdating(false);
    }
  }

  async function handleRefreshCadenceChange(refreshCadence: RefreshCadence) {
    if (!dataset || savingRefreshCadence || userId !== dataset.ownerId) return;
    setSavingRefreshCadence(true);
    try {
      await updateRefreshSettings({
        id: dataset._id,
        refreshCadence,
      });
    } catch (err) {
      console.error("[refresh cadence] failed", err);
      captureException(err, {
        operation: "dataset_refresh_cadence_update",
        datasetId: dataset._id,
      });
    } finally {
      setSavingRefreshCadence(false);
    }
  }

  async function handleMaxRowCountChange(maxRowCount: number) {
    if (!dataset || savingMaxRowCount || userId !== dataset.ownerId) return;
    if (!Number.isInteger(maxRowCount) || maxRowCount < 1) {
      setMaxRowCountSaveError("Max rows must be a whole number greater than 0.");
      captureException(new Error("Invalid max row count"), {
        operation: "dataset_max_row_count_update",
        datasetId: dataset._id,
      });
      return;
    }
    if (usage && maxRowCount > usage.remaining) {
      setMaxRowCountSaveError(
        `Max rows cannot exceed your remaining monthly quota of ${usage.remaining.toLocaleString()} row operations.`,
      );
      return;
    }

    setMaxRowCountSaveError(null);
    setSavingMaxRowCount(true);
    try {
      await updateMaxRowCount({
        id: dataset._id,
        maxRowCount,
      });
      setMaxRowCountSaveError(null);
    } catch (err) {
      console.error("[max rows] failed", err);
      setMaxRowCountSaveError(
        err instanceof Error ? err.message : "Failed to update max rows.",
      );
      captureException(err, {
        operation: "dataset_max_row_count_update",
        datasetId: dataset._id,
      });
    } finally {
      setSavingMaxRowCount(false);
    }
  }

  async function handleStop() {
    if (!dataset || stopping) return;
    if (dataset.status !== "building" && dataset.status !== "updating") return;
    setStopping(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await stopPopulation(dataset._id, token);
      track(EVENTS.DATASET_STOP_REQUESTED, {
        datasetId: dataset._id,
        status: dataset.status,
      });
      // Do NOT clear stopping here. Keep it true until Convex confirms the
      // dataset has left the busy state (via the isDatasetBusy effect below).
      // This prevents the button from briefly re-enabling during the cleanup window.
    } catch (err) {
      console.error("[stop] failed", err);
      captureException(err, {
        operation: "dataset_stop",
        datasetId: dataset._id,
      });
      // Request failed — clear immediately so the user can retry.
      setStopping(false);
    }
  }

  async function handleDelete() {
    if (!dataset || deleting || dataset.status === "building" || dataset.status === "updating") return;
    setDeleting(true);
    try {
      await removeDataset({ id: dataset._id });
      setConfirmDelete(false);
      router.replace("/dashboard");
    } catch (err) {
      console.error("[delete] failed", err);
      captureException(err, { operation: "dataset_delete", datasetId: dataset._id });
    } finally {
      setDeleting(false);
    }
  }

  // Computed before the loading guard so the useEffect below can depend on it
  // without hitting the TDZ. Optional chaining handles the pre-load undefined state.
  const isDatasetBusy = dataset?.status === "building" || dataset?.status === "updating";

  // Clear the stop latch once the dataset is confirmed not-busy by Convex.
  // Using setTimeout defers the setState out of the synchronous effect body,
  // satisfying the react-hooks/set-state-in-effect lint rule while preserving
  // the same semantic: latch clears on the next tick after the status transition.
  useEffect(() => {
    if (!isDatasetBusy) {
      const id = setTimeout(() => setStopping(false), 0);
      return () => clearTimeout(id);
    }
  }, [isDatasetBusy]);
  if (authLoading || dataset === undefined || rows === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }
  // Past this point `dataset` and `rows` are always defined. If the
  // server-side authz layer rejected the request, `useQuery` would have
  // thrown instead — caught by /dataset/[id]/error.tsx, which renders
  // the "Dataset not found" UI.

  const exportDisabled = exporting !== null || rows.length === 0;
  const isOwner = userId === dataset.ownerId;
  const displayDataset = {
    ...dataset,
    refreshCadence: dataset.refreshCadence ?? "daily",
    refreshEnabled: dataset.refreshEnabled ?? true,
    maxRowCount: dataset.maxRowCount ?? 100,
  };
  const updateDisabled = updating || isDatasetBusy;
  const populateDisabled = populating || isDatasetBusy;
  const stopDisabled = stopping || !isDatasetBusy;
  const stopLabel = stopping ? "Stopping…" : "Stop";
  const updateLabel = dataset.status === "updating"
    ? "Updating…"
    : dataset.status === "building"
      ? "Building…"
      : updating
        ? "Starting…"
        : selectedCount > 0
          ? `Update (${selectedCount})`
          : "Update Dataset";
  const populateLabel = isDatasetBusy
    ? (dataset.status === "updating" ? "Updating…" : "Building…")
    : populating
      ? "Starting…"
      : dataset.status === "failed"
        ? "Retry Populate"
        : "Clear & Populate";
  const exportLabel = exporting
    ? "Exporting…"
    : selectedCount > 0
      ? `Export (${selectedCount})`
      : "Export";

  return (
    <div className="flex flex-1 flex-col h-screen">
      <header className="border-b border-border px-5 py-2.5 flex items-center justify-between bg-surface shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard" className="hover:opacity-80 transition-opacity shrink-0">
            <img src="/BigSetLogo.png" alt="BigSet" className="h-[24px] dark:hidden" />
            <img src="/BigSetLogoDarkBG.png" alt="BigSet" className="h-[24px] hidden dark:block" />
          </Link>
          <svg width="8" height="20" viewBox="0 0 8 20" className="text-border shrink-0" aria-hidden="true">
            <line x1="7" y1="0" x2="1" y2="20" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <h1 className="text-sm font-semibold tracking-tight truncate max-w-md">
            {dataset.name}
          </h1>
          <StatusBadge status={dataset.status} />
        </div>
        <div className="flex items-center gap-1.5">
          <ExportDropdown
            open={exportOpen}
            onToggle={() => setExportOpen((o) => !o)}
            onClose={() => setExportOpen(false)}
            label={exportLabel}
            disabled={exportDisabled}
            exporting={exporting}
            selectedCount={selectedCount}
            onExport={(fmt) => { setExportOpen(false); handleExport(fmt); }}
          />

          {isDatasetBusy && (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopDisabled}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/[0.12] disabled:opacity-40 dark:text-amber-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              {stopLabel}
            </button>
          )}

          <SettingsDropdown
            open={settingsOpen}
            onToggle={() => setSettingsOpen((o) => !o)}
            onClose={() => setSettingsOpen(false)}
            refreshCadence={displayDataset.refreshCadence}
            refreshCadenceDisabled={!isOwner || savingRefreshCadence}
            maxRowCount={displayDataset.maxRowCount}
            maxRowCountRemaining={usage?.remaining}
            maxRowCountSaveError={maxRowCountSaveError}
            maxRowCountDisabled={!isOwner || savingMaxRowCount}
            updateLabel={updateLabel}
            updateDisabled={updateDisabled}
            populateLabel={populateLabel}
            populateDisabled={populateDisabled}
            onRefreshCadenceChange={handleRefreshCadenceChange}
            onMaxRowCountChange={handleMaxRowCountChange}
            onUpdate={() => { setSettingsOpen(false); handleUpdate(); }}
            onPopulate={() => {
              setSettingsOpen(false);
              if (rows.length > 0) {
                setConfirmPopulate(true);
              } else {
                handlePopulate();
              }
            }}
            onDelete={isOwner && !isDatasetBusy ? () => { setSettingsOpen(false); setConfirmDelete(true); } : undefined}
          />

          <div className="w-px h-4 bg-border mx-0.5" />

          <DatasetProfileMenu user={user} onSignOut={() => signOut()} />
        </div>
      </header>

      <div className="border-b border-border px-5 py-2.5 flex items-center gap-4 bg-surface/50 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted truncate">
            {dataset.description}
          </p>
          {dataset.status === "failed" && dataset.lastStatusError && (
            <p role="status" className="mt-1 truncate text-xs font-medium text-red-600 dark:text-red-400">
              Last populate failed: {dataset.lastStatusError}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px] text-muted shrink-0">
          {selectedCount > 0 && (
            <>
              <span className="text-foreground/80 font-medium">
                {selectedCount} selected
              </span>
              <span className="text-foreground/10">|</span>
            </>
          )}
          <span>{rows.length} rows</span>
          <span className="text-foreground/10">|</span>
          <span>{dataset.columns.length} columns</span>
        </div>
      </div>

      <DatasetTable
        dataset={displayDataset}
        rows={rows}
        datasetId={datasetId}
        selection={selection}
        onCellExpand={handleCellExpand}
      />

      <SideSheet open={cellDetail !== null} onClose={() => setCellDetail(null)}>
        {cellDetail && (
          <CellDetail
            column={cellDetail.column}
            value={cellDetail.value}
            sources={cellDetail.sources}
          />
        )}
      </SideSheet>

      {confirmPopulate && (
        <ConfirmPopulateModal
          rowCount={rows.length}
          onConfirm={() => {
            setConfirmPopulate(false);
            handlePopulate();
          }}
          onCancel={() => setConfirmPopulate(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          datasetName={dataset.name}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => { if (!deleting) setConfirmDelete(false); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export dropdown                                                     */
/* ------------------------------------------------------------------ */

function ExportDropdown({
  open,
  onToggle,
  onClose,
  label,
  disabled,
  exporting,
  selectedCount,
  onExport,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  label: string;
  disabled: boolean;
  exporting: "csv" | "xlsx" | null;
  selectedCount: number;
  onExport: (fmt: "csv" | "xlsx") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  const hint = selectedCount > 0
    ? `${selectedCount} row${selectedCount === 1 ? "" : "s"} selected`
    : "All rows";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {label}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-50"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-border bg-surface shadow-xl ring-1 ring-black/[0.04] z-50 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border">
            <p className="text-[11px] text-muted">{hint}</p>
          </div>
          <div className="p-1">
            <button
              onClick={() => onExport("csv")}
              disabled={exporting !== null}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-40"
            >
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-foreground/[0.06]">.csv</span>
              {exporting === "csv" ? "Exporting…" : "Comma-separated"}
            </button>
            <button
              onClick={() => onExport("xlsx")}
              disabled={exporting !== null}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-40"
            >
              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-foreground/[0.06]">.xlsx</span>
              {exporting === "xlsx" ? "Exporting…" : "Excel spreadsheet"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings dropdown                                                  */
/* ------------------------------------------------------------------ */

function SettingsDropdown({
  open,
  onToggle,
  onClose,
  refreshCadence,
  refreshCadenceDisabled,
  maxRowCount,
  maxRowCountRemaining,
  maxRowCountSaveError,
  maxRowCountDisabled,
  updateLabel,
  updateDisabled,
  populateLabel,
  populateDisabled,
  onRefreshCadenceChange,
  onMaxRowCountChange,
  onUpdate,
  onPopulate,
  onDelete,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  refreshCadence: RefreshCadence;
  refreshCadenceDisabled: boolean;
  maxRowCount: number;
  maxRowCountRemaining?: number;
  maxRowCountSaveError: string | null;
  maxRowCountDisabled: boolean;
  updateLabel: string;
  updateDisabled: boolean;
  populateLabel: string;
  populateDisabled: boolean;
  onRefreshCadenceChange: (refreshCadence: RefreshCadence) => void;
  onMaxRowCountChange: (maxRowCount: number) => void;
  onUpdate: () => void;
  onPopulate: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxRowCountInput, setMaxRowCountInput] = useState(String(maxRowCount));
  const parsedMaxRowCount = Number(maxRowCountInput);
  const maxRowCountValidationError =
    !maxRowCountInput.trim()
      ? "Required"
      : !Number.isInteger(parsedMaxRowCount) || parsedMaxRowCount < 1
        ? "Use a whole number"
        : maxRowCountRemaining !== undefined && parsedMaxRowCount > maxRowCountRemaining
          ? `Max ${maxRowCountRemaining.toLocaleString()}`
          : null;
  const maxRowCountChanged =
    Number.isInteger(parsedMaxRowCount) && parsedMaxRowCount !== maxRowCount;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      const id = setTimeout(() => setMaxRowCountInput(String(maxRowCount)), 0);
      return () => clearTimeout(id);
    }
  }, [maxRowCount, open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        Settings
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-50"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-border bg-surface shadow-xl ring-1 ring-black/[0.04] z-50 overflow-hidden">
          <div className="p-1">
            <button
              onClick={onUpdate}
              disabled={updateDisabled}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              {updateLabel}
            </button>
            <button
              onClick={onPopulate}
              disabled={populateDisabled}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-red-500 bg-red-500/[0.04] hover:bg-red-500/[0.1] transition-colors disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              {populateLabel}
            </button>
          </div>
          <div className="border-t border-border p-2">
            <div className="mb-1 text-[11px] font-medium text-muted">
              Max rows
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={maxRowCountInput}
                disabled={maxRowCountDisabled}
                onChange={(e) => setMaxRowCountInput(e.currentTarget.value)}
                onBlur={() => {
                  if (!maxRowCountInput.trim()) return;
                  const value = Number(maxRowCountInput);
                  if (Number.isInteger(value) && value >= 1) {
                    setMaxRowCountInput(String(value));
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-foreground/30 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={
                  maxRowCountDisabled ||
                  !maxRowCountChanged ||
                  maxRowCountValidationError !== null
                }
                onClick={() => onMaxRowCountChange(parsedMaxRowCount)}
                className="rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
            </div>
            <p className={`mt-1 text-[11px] ${maxRowCountValidationError || maxRowCountSaveError ? "text-red-500" : "text-muted"}`}>
              {maxRowCountValidationError ??
                maxRowCountSaveError ??
                (maxRowCountRemaining !== undefined
                  ? `${maxRowCountRemaining.toLocaleString()} row operations available`
                  : "Applies to the next populate run")}
            </p>
          </div>
          <div className="border-t border-border p-1">
            <div className="px-2 py-1 text-[11px] font-medium text-muted">
              Refresh cadence
            </div>
            {REFRESH_CADENCE_OPTIONS.map((option) => {
              const selected = refreshCadence === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onRefreshCadenceChange(option.value)}
                  disabled={refreshCadenceDisabled || selected}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors disabled:cursor-default disabled:opacity-60"
                >
                  <span>{refreshCadenceLabel(option.value)}</span>
                  {selected && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {onDelete && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={onDelete}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/[0.08] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Delete dataset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile menu (matches dashboard)                                   */
/* ------------------------------------------------------------------ */

function DatasetProfileMenu({
  user,
  onSignOut,
}: {
  user: ProfileUser | null | undefined;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const name = user?.fullName || user?.firstName || "User";
  const email = user?.primaryEmailAddress?.emailAddress;
  const imageUrl = user?.imageUrl;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-0.5 hover:bg-foreground/[0.05] transition-colors"
        aria-label="Profile menu"
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <div className="h-6 w-6 rounded-full bg-foreground/10 flex items-center justify-center text-[11px] font-medium text-foreground">
            {name[0]?.toUpperCase()}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-border bg-surface shadow-xl ring-1 ring-black/[0.04] z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-foreground truncate">{name}</p>
            {email && (
              <p className="text-[11px] text-muted truncate mt-0.5">{email}</p>
            )}
          </div>
          <div className="p-1">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors"
            >
              <span>Dark mode</span>
              <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${theme === "dark" ? "bg-foreground" : "bg-foreground/20"}`}>
                <span className={`inline-block h-3 w-3 rounded-full bg-surface transition-transform ${theme === "dark" ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </span>
            </button>
            <button
              onClick={() => { setOpen(false); onSignOut(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/[0.08] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm populate modal                                             */
/* ------------------------------------------------------------------ */

function ConfirmPopulateModal({
  rowCount,
  onConfirm,
  onCancel,
}: {
  rowCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-populate-title" className="w-full max-w-xs rounded-xl border border-border bg-surface shadow-2xl p-4 text-center">
        <p id="confirm-populate-title" className="text-sm font-semibold text-foreground">
          This will delete {rowCount === 1 ? "1 row" : `${rowCount} rows`}. This can&apos;t be undone.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg bg-foreground/[0.06] py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.1] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
          >
            Delete &amp; populate
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm delete modal                                               */
/* ------------------------------------------------------------------ */

function ConfirmDeleteModal({
  datasetName,
  deleting,
  onConfirm,
  onCancel,
}: {
  datasetName: string;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title" className="w-full max-w-xs rounded-xl border border-border bg-surface shadow-2xl p-4 text-center">
        <p id="confirm-delete-title" className="text-sm font-semibold text-foreground">
          Delete &ldquo;{datasetName}&rdquo;?
        </p>
        <p className="mt-1 text-xs text-muted">All rows will be permanently deleted. This can&apos;t be undone.</p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 rounded-lg bg-foreground/[0.06] py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.1] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete dataset"}
          </button>
        </div>
      </div>
    </div>
  );
}
