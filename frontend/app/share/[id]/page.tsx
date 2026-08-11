"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppAuth, useAppConvexAuth } from "@/lib/app-auth";
import { captureException } from "@/lib/analytics";

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  boolean: "Boolean",
  url: "URL",
  date: "Date",
};

export default function SharePreviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { isAuthenticated, isLoading: authLoading } = useAppConvexAuth();
  const { userId } = useAppAuth();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dataset = useQuery(api.datasets.get, { id: id as Id<"datasets"> });
  const rows = useQuery(
    api.datasetRows.listByDataset,
    dataset ? { datasetId: id as Id<"datasets"> } : "skip",
  );
  const importDataset = useMutation(api.datasets.importDataset);

  async function handleImport() {
    if (!dataset || importing) return;
    setImporting(true);
    setError(null);
    try {
      const newId = await importDataset({ sourceId: id as Id<"datasets"> });
      router.push(`/dataset/${newId}`);
    } catch (err) {
      captureException(err, { operation: "dataset_import", sourceId: id });
      setError(err instanceof Error ? err.message : "Failed to import dataset.");
    } finally {
      setImporting(false);
    }
  }

  if (authLoading || dataset === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (!dataset || dataset.visibility !== "public") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted">Dataset not found.</p>
          <p className="mt-1 text-xs text-muted/70">It may have been deleted or made private.</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-foreground hover:underline">
            Go to BigSet
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = !!userId && userId === dataset.ownerId;
  const previewRows = (rows ?? []).slice(0, 5);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface px-6 py-3 flex items-center justify-between">
        <Link href="/">
          <img src="/BigSetLogo.png" alt="BigSet" className="h-[24px] dark:hidden" />
          <img src="/BigSetLogoDarkBG.png" alt="BigSet" className="h-[24px] hidden dark:block" />
        </Link>
        <Link
          href="/dashboard"
          className="text-xs font-medium text-muted hover:text-foreground transition-colors"
        >
          My Datasets
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-2">
          <span className="text-[11px] uppercase tracking-[0.15em] text-muted font-semibold">
            Shared Dataset
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {dataset.name}
        </h1>

        {dataset.description && (
          <p className="mt-2 text-sm text-muted leading-relaxed">
            {dataset.description}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3 text-xs text-muted">
          <span>{dataset.columns.length} column{dataset.columns.length !== 1 ? "s" : ""}</span>
          <span className="text-foreground/15">·</span>
          <span>{dataset.rowCount ?? 0} row{(dataset.rowCount ?? 0) !== 1 ? "s" : ""}</span>
        </div>

        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-[0.12em] font-semibold text-muted mb-3">
            Columns
          </h2>
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {dataset.columns.map((col, i) => (
              <div
                key={col.name}
                className={`flex items-start gap-3 px-4 py-3 ${i !== 0 ? "border-t border-border" : ""}`}
              >
                <span className="mt-0.5 shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted uppercase tracking-wide">
                  {TYPE_LABELS[col.type] ?? col.type}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{col.name}</p>
                  {col.description && (
                    <p className="mt-0.5 text-[11px] text-muted">{col.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {previewRows.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs uppercase tracking-[0.12em] font-semibold text-muted mb-3">
              Preview
            </h2>
            <div className="rounded-xl border border-border bg-surface overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {dataset.columns.map((col) => (
                      <th
                        key={col.name}
                        className="px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap"
                      >
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={row._id} className={i !== 0 ? "border-t border-border" : ""}>
                      {dataset.columns.map((col) => (
                        <td
                          key={col.name}
                          className="px-3 py-2 text-foreground/80 max-w-[200px] truncate"
                        >
                          {String(row.data[col.name] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(dataset.rowCount ?? 0) > 5 && (
              <p className="mt-2 text-[11px] text-muted text-center">
                Showing 5 of {dataset.rowCount} rows
              </p>
            )}
          </div>
        )}

        <div className="mt-10 rounded-xl border border-border bg-surface p-6 text-center">
          {isOwner ? (
            <>
              <p className="text-sm font-semibold text-foreground">This is your dataset</p>
              <p className="mt-1 text-xs text-muted">
                You shared this link. Others can use it to add a copy to their BigSet.
              </p>
              <Link
                href={`/dataset/${id}`}
                className="mt-4 inline-block w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 text-center"
              >
                View your dataset
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">Add this dataset to your BigSet</p>
              <p className="mt-1 text-xs text-muted">
                Import the schema and populate it with fresh data from the web.
              </p>

              {error && (
                <p className="mt-3 text-xs text-red-500">{error}</p>
              )}

              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing}
                  className="mt-4 w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {importing ? "Adding..." : "Add to my BigSet"}
                </button>
              ) : (
                <Link
                  href={`/sign-in?redirect_url=/share/${id}`}
                  className="mt-4 block w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 text-center"
                >
                  Sign in to add this dataset
                </Link>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
