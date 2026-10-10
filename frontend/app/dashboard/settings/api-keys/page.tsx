"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Plus, Trash2, KeyRound } from "lucide-react";
import { SettingsPageLayout } from "@/components/settings/SettingsPageLayout";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAppAuth } from "@/lib/app-auth";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyInfo,
  type CreatedApiKey,
} from "@/lib/backend";

const navItems = [
  {
    label: "Models",
    href: "/dashboard/settings/models",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    label: "API Keys",
    href: "/dashboard/settings/api-keys",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
        <path d="m21 2-9.6 9.6" />
        <circle cx="7.5" cy="15.5" r="5.5" />
      </svg>
    ),
  },
  {
    label: "Account",
    href: "/dashboard/settings/account",
    disabled: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    label: "Billing",
    href: "/dashboard/settings/billing",
    disabled: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </svg>
    ),
  },
];

export default function ApiKeysSettingsPage() {
  const { getToken } = useAppAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const { keys } = await listApiKeys(token);
      setKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const created = await createApiKey(newName.trim() || "Default key", token);
      setCreatedKey(created);
      setNewName("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await revokeApiKey(id, token);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key.");
    } finally {
      setRevokingId(null);
    }
  }

  function copyKey() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SettingsPageLayout navItems={navItems}>
      <div className="w-full max-w-4xl">
        <SettingsHeader
          title="API Keys"
          subtitle="Create keys to authenticate the Google Sheets add-on or the CLI. Keys are shown once — copy them immediately."
        />

        {createdKey && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Copy your API key now
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">
                  You won&apos;t be able to see it again.
                </p>
              </div>
              <button
                onClick={copyKey}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300 transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="mt-2 block rounded-md bg-amber-100/60 px-3 py-2 text-xs font-mono text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 break-all">
              {createdKey.key}
            </code>
            <button
              onClick={() => setCreatedKey(null)}
              className="mt-2 text-xs text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300 underline"
            >
              Done
            </button>
          </div>
        )}

        <div className="mb-6 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Key name (e.g. Sheets add-on)"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground/30"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-4 py-2 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? (
              "Creating…"
            ) : (
              <>
                <Plus size={14} />
                Create
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted">Loading…</div>
        ) : keys && keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <KeyRound size={32} className="text-muted/40" />
            <p className="mt-3 text-sm text-muted">No API keys yet.</p>
            <p className="text-xs text-muted/60 mt-1">
              Create one above to connect the Sheets add-on.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {keys?.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-surface">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{k.name}</p>
                  <p className="text-xs text-muted mt-0.5 font-mono">
                    {k.keyPrefix}…••••••
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-[11px] text-muted">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                    </p>
                    {k.lastUsedAt && (
                      <p className="text-[11px] text-muted/70">
                        Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { if (confirm("Revoke this API key? This action cannot be undone.")) handleRevoke(k.id); }}
                    disabled={revokingId === k.id}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted hover:text-red-600 hover:bg-red-500/8 transition-colors disabled:opacity-50"
                    title="Revoke"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsPageLayout>
  );
}
