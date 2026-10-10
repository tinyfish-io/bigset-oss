"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { DatasetMeta } from "@/lib/fetch-dataset-meta";
import {
  DatasetCard,
  type DatasetCardData,
} from "@/components/dataset/DatasetCard";
import { useTheme } from "@/components/ThemeToggle";
import { QuotaBadge } from "@/components/QuotaBadge";
import { LocalUtilityMenu } from "@/components/LocalUtilityMenu";
import { EVENTS, track } from "@/lib/analytics";
import type { ProfileUser } from "@/lib/profile-user";
import { useAppClerk, useAppConvexAuth, useAppUser } from "@/lib/app-auth";
import { isLocalMode } from "@/lib/app-mode";

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAppConvexAuth();
  const { user } = useAppUser();
  const { signOut } = useAppClerk();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const mine = useQuery(
    api.datasets.listMine,
    isAuthenticated ? {} : "skip",
  );
  const showCurated = !isLocalMode;
  const curated = useQuery(
    api.datasets.listPublic,
    showCurated ? {} : "skip",
  );

  // Quota limits are cloud-only. Local mode can create datasets without this gate.
  const usage = useQuery(
    api.quota.getMy,
    !isLocalMode && isAuthenticated ? {} : "skip",
  );
  const atLimit = !isLocalMode && usage !== undefined && usage.remaining === 0;

  // Fire dashboard_viewed once per mount when both queries have resolved,
  // so we attach accurate counts. `dashboardFired` prevents the effect
  // from re-firing when filtered counts change due to typing in search.
  const dashboardFired = useRef(false);
  useEffect(() => {
    if (
      !dashboardFired.current &&
      isAuthenticated &&
      mine !== undefined &&
      (!showCurated || curated !== undefined)
    ) {
      dashboardFired.current = true;
      track(EVENTS.DASHBOARD_VIEWED, {
        owned_count: mine.length,
        curated_count: showCurated ? (curated?.length ?? 0) : 0,
      });
    }
  }, [isAuthenticated, mine, curated, showCurated]);

  const { filteredMine, filteredCurated } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const apply = (list: typeof mine) =>
      (list ?? []).filter((ds) =>
        !q ||
        ds.name.toLowerCase().includes(q) ||
        ds.description.toLowerCase().includes(q),
      );
    return {
      filteredMine: apply(mine),
      filteredCurated: apply(curated),
    };
  }, [mine, curated, search]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-surface">
        <img src="/BigSetLogo.png" alt="BigSet" className="h-[30px] dark:hidden" />
        <img src="/BigSetLogoDarkBG.png" alt="BigSet" className="h-[30px] hidden dark:block" />
        <div className="flex items-center gap-4">
          {isLocalMode ? (
            <LocalUtilityMenu />
          ) : (
            <>
              <QuotaBadge />
              <div className="w-px h-4 bg-border" />
              <ProfileMenu user={user} onSignOut={() => signOut()} />
            </>
          )}
        </div>
      </header>

      <main className="flex-1 px-6 py-10 max-w-[1280px] mx-auto w-full">
        <div className="mb-8">
          <h2 className="text-[28px] font-bold tracking-tight leading-none">
            Your Datasets
          </h2>
          <p className="mt-2 text-sm text-muted">
            Live, updating datasets — powered by web agents.
          </p>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                // Fire on blur, not every keystroke. Send length, not the
                // query string itself — search terms can be sensitive
                // ("looking for a job at X"). Length is enough for the funnel.
                if (search.trim().length > 0) {
                  track(EVENTS.DATASET_SEARCH_USED, {
                    query_length: search.trim().length,
                    mine_count: filteredMine.length,
                    curated_count: filteredCurated.length,
                  });
                }
              }}
              placeholder="Search datasets..."
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none placeholder:text-muted/60 focus:border-foreground/30 transition-[border-color] duration-150"
            />
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.05]"
          >
            Import
          </button>

          {atLimit ? (
            <div className="relative group">
              <span
                role="button"
                tabIndex={0}
                aria-disabled="true"
                aria-describedby="quota-popover"
                className="inline-block rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-muted cursor-not-allowed select-none focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                + New Dataset
              </span>
              {/*
                Custom popover beside the disabled button. Replaces the
                native `title=""` tooltip so we can style consistently
                with the rest of the UI and use the exact wording requested.
                Shown on hover via Tailwind's `group-hover`.
              */}
              <div
                id="quota-popover"
                role="tooltip"
                className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-20 w-64 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground opacity-0 translate-x-[-4px] transition-all duration-150 ease-out shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0"
              >
                <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rotate-45 border-l border-b border-border bg-surface" />
                Free-tier limit reached (2,500 row modifications). Please upgrade.
              </div>
            </div>
          ) : (
            <Link
              href="/dataset/new"
              className="rounded-lg border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90"
            >
              + New Dataset
            </Link>
          )}
        </div>

        <Section
          eyebrow="Yours"
          heading="Datasets you own"
          isLoading={mine === undefined}
          datasets={filteredMine as unknown as DatasetCardData[]}
          emptyState={
            search
              ? `No datasets of yours match "${search}".`
              : atLimit
                ? "You've used all of this month's free-tier quota. New datasets will be available again when the quota resets at the start of next month."
                : "No datasets yet. Click \"+ New Dataset\" above to create your first one."
          }
        />

        {!isLocalMode && (
          <>
            <div className="h-12" />

            <Section
              eyebrow="Curated by BigSet"
              heading="Explore live datasets"
              isLoading={curated === undefined}
              datasets={filteredCurated as unknown as DatasetCardData[]}
              emptyState={
                search
                  ? `No curated datasets match "${search}".`
                  : "Curated datasets coming soon."
              }
            />
          </>
        )}
      </main>

      {importOpen && (
        <ImportModal onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crossPreview, setCrossPreview] = useState<DatasetMeta | null | "loading">(null);
  const importDataset = useMutation(api.datasets.importDataset);
  const importDatasetFromSchema = useMutation(api.datasets.importDatasetFromSchema);

  function parseShareUrl(input: string): { id: string; origin: string } | null {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      const match = parsed.pathname.match(/\/(?:dataset|share)\/([^/?#]+)/);
      const id = match?.[1] ?? null;
      if (id && /^[a-zA-Z0-9]{20,}$/.test(id)) return { id, origin: parsed.origin };
      return null;
    } catch {
      return null;
    }
  }

  const parsed = parseShareUrl(url);
  const extractedId = parsed?.id ?? null;
  const sourceOrigin = parsed?.origin ?? null;
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const isCrossInstance = !!sourceOrigin && sourceOrigin !== currentOrigin;

  const sameInstancePreview = useQuery(
    api.datasets.get,
    !isCrossInstance && extractedId ? { id: extractedId as Id<"datasets"> } : "skip",
  );

  useEffect(() => {
    if (!isCrossInstance || !extractedId || !sourceOrigin) {
      setCrossPreview(null);
      return;
    }
    setCrossPreview("loading");
    const controller = new AbortController();

    let fallback: DatasetMeta | null = null;
    try {
      const schemaParam = new URL(url.trim()).searchParams.get("schema");
      if (schemaParam) {
        const bytes = Uint8Array.from(atob(schemaParam), c => c.charCodeAt(0));
        fallback = JSON.parse(new TextDecoder().decode(bytes)) as DatasetMeta;
      }
    } catch {}

    fetch(`${sourceOrigin}/api/share/${extractedId}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DatasetMeta | null) => setCrossPreview(data ?? fallback))
      .catch(() => setCrossPreview(fallback));
    return () => controller.abort();
  }, [isCrossInstance, extractedId, sourceOrigin, url]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const preview: DatasetMeta | null | undefined = isCrossInstance
    ? (crossPreview === "loading" ? undefined : crossPreview)
    : (sameInstancePreview as DatasetMeta | null | undefined);

  const previewLoading = isCrossInstance
    ? crossPreview === "loading"
    : extractedId !== null && sameInstancePreview === undefined;

  const isValidUrl = extractedId !== null;
  const isPublic = isCrossInstance
    ? preview !== null && preview !== undefined
    : preview !== null && preview !== undefined && (preview as { visibility?: string }).visibility === "public";

  async function handleImport() {
    if (!extractedId || importing || !preview) return;
    setImporting(true);
    setError(null);
    try {
      let newId: Id<"datasets">;
      if (isCrossInstance) {
        newId = await importDatasetFromSchema({
          name: preview.name,
          description: preview.description,
          columns: preview.columns,
        });
      } else {
        newId = await importDataset({ sourceId: extractedId as Id<"datasets"> });
      }
      onClose();
      router.push(`/dataset/${newId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import dataset.";
      setError(
        msg.toLowerCase().includes("quota")
          ? "You've reached your free-tier quota. Upgrade to import more datasets."
          : msg,
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="import-modal-title" className="w-full max-w-sm rounded-xl border border-border bg-surface shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p id="import-modal-title" className="text-sm font-semibold text-foreground">Import Dataset</p>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <p className="text-xs text-muted mb-3">Paste a BigSet dataset link to add it to your account.</p>

        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); }}
          placeholder="https://..."
          className="w-full rounded-lg border border-border bg-foreground/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted/50 outline-none focus:border-foreground/30 transition-[border-color]"
        />

        {isValidUrl && previewLoading && (
          <p className="mt-2 text-[11px] text-muted">Loading preview...</p>
        )}

        {isValidUrl && !previewLoading && preview === null && (
          <p className="mt-2 text-[11px] text-red-500">Dataset not found or not accessible.</p>
        )}

        {preview && (
          <div className="mt-3 rounded-lg border border-border bg-foreground/[0.02] p-3">
            <p className="text-xs font-semibold text-foreground truncate">{preview.name}</p>
            {preview.description && (
              <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{preview.description}</p>
            )}
            <p className="mt-1.5 text-[11px] text-muted">
              {preview.columns.length} column{preview.columns.length !== 1 ? "s" : ""}
              {preview.rowCount ? ` · ${preview.rowCount} rows` : ""}
            </p>
            {!isPublic && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">This dataset is private and cannot be imported.</p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-2 text-[11px] text-red-500">{error}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-foreground/[0.06] py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.1] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!preview || !isPublic || importing}
            className="flex-1 rounded-lg bg-accent py-1.5 text-xs font-semibold text-accent-text hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {importing ? "Adding..." : "Add to my BigSet"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  heading,
  isLoading,
  datasets,
  emptyState,
}: {
  eyebrow: string;
  heading: string;
  isLoading: boolean;
  datasets: DatasetCardData[];
  emptyState: string;
}) {
  return (
    <div>
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted font-semibold">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">
          {heading}
        </h3>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      ) : datasets.length === 0 ? (
        <div className="border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted">{emptyState}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {datasets.map((ds) => (
            <DatasetCard key={ds._id} dataset={ds} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileMenu({
  user,
  onSignOut,
}: {
  user: ProfileUser | null | undefined;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const { theme, toggle: toggleTheme } = useTheme();
  const name = user?.fullName || user?.firstName || "User";
  const email = user?.primaryEmailAddress?.emailAddress;
  const imageUrl = user?.imageUrl;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu"
        className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 hover:bg-foreground/[0.05] transition-colors"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-foreground/10 flex items-center justify-center text-[11px] font-medium text-foreground">
            {name[0]?.toUpperCase()}
          </div>
        )}
        <span className="text-xs font-medium text-foreground">{name}</span>
      </button>

      {open && (
        <div id="profile-menu" role="menu" className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-border bg-surface shadow-xl ring-1 ring-black/[0.04] z-50 overflow-hidden">
          {!isLocalMode && (
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium text-foreground truncate">{name}</p>
              {email && (
                <p data-ph-mask-text="true" className="text-[11px] text-muted truncate mt-0.5">
                  {email}
                </p>
              )}
            </div>
          )}
          <div className="p-1">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors"
            >
              <span>Dark mode</span>
              <span
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${theme === "dark" ? "bg-foreground" : "bg-foreground/20"}`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-surface transition-transform ${theme === "dark" ? "translate-x-3.5" : "translate-x-0.5"}`}
                />
              </span>
            </button>
            <button
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/settings");
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-foreground hover:bg-foreground/[0.05] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              </svg>
              Settings
            </button>
            {!isLocalMode && (
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/[0.08] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
