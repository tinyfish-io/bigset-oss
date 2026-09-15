"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  X,
} from "lucide-react";
import {
  getLocalSetupStatus,
  saveOpenRouterApiKey,
  saveOrcaRouterApiKey,
  saveTinyFishApiKey,
  type LocalSetupStatus,
  type ServiceSetupStatus,
} from "@/lib/backend";
import { isLocalMode } from "@/lib/app-mode";

type ServiceName = "tinyfish" | "openrouter" | "orcarouter";

const SERVICE_COPY = {
  tinyfish: {
    modalTitle: "TinyFish API key",
    description:
      "BigSet uses TinyFish's best-in-class search API to unlock real-time information.",
    inputPlaceholder: "tf_...",
    modalDescription: "BigSet verifies the key and stores it in your OS keychain.",
    helperHref:
      "https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2",
    helperLabel: "Need a TinyFish key?",
    helperDescription: "Open the TinyFish API keys page",
  },
  openrouter: {
    modalTitle: "OpenRouter API key",
    description:
      "BigSet uses OpenRouter's API to power BigSet with AI model access.",
    inputPlaceholder: "sk-or-...",
    modalDescription:
      "BigSet verifies the key and stores it in your OS keychain.",
    helperHref: "https://openrouter.ai/settings/keys",
    helperLabel: "Need an OpenRouter key?",
    helperDescription: "Open the OpenRouter keys page",
  },
  orcarouter: {
    modalTitle: "OrcaRouter API key",
    description:
      "BigSet uses OrcaRouter's API to power BigSet with AI model access.",
    inputPlaceholder: "sk-orca-...",
    modalDescription:
      "BigSet verifies the key and stores it in your OS keychain.",
    helperHref: "https://www.orcarouter.ai",
    helperLabel: "Learn more about OrcaRouter",
    helperDescription: "Open orcarouter.ai",
  },
} satisfies Record<
  ServiceName,
  {
    modalTitle: string;
    description: string;
    inputPlaceholder: string;
    modalDescription: string;
    helperHref: string;
    helperLabel: string;
    helperDescription: string;
  }
>;

export function LocalCredentialsPanel() {
  const [status, setStatus] = useState<LocalSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ServiceName | null>(null);

  useEffect(() => {
    if (!isLocalMode) return;

    let active = true;
    getLocalSetupStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((err) => {
        if (active) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Could not load local credentials",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!isLocalMode) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 max-w-2xl">
        <h2 className="text-sm font-semibold text-foreground">
          Service credentials
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Add TinyFish and OpenRouter or OrcaRouter access for live datasets.
          Local keys stay in your OS keychain.
        </p>
      </div>

      {loadError ? (
        <div className="border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </div>
      ) : (
        <div className="grid gap-4">
          <CredentialCard
            service="tinyfish"
            status={status?.services.tinyfish}
            loading={loading}
            onApiKey={() => setModal("tinyfish")}
          />
          <CredentialCard
            service="openrouter"
            status={status?.services.openrouter}
            loading={loading}
            onApiKey={() => setModal("openrouter")}
          />
          <CredentialCard
            service="orcarouter"
            status={status?.services.orcarouter}
            loading={loading}
            onApiKey={() => setModal("orcarouter")}
          />
        </div>
      )}

      {modal && (
        <ApiKeyModal
          service={modal}
          onClose={() => setModal(null)}
          onSaved={(next) => {
            setStatus(next);
            setModal(null);
          }}
        />
      )}
    </section>
  );
}

function CredentialCard({
  service,
  status,
  loading,
  onApiKey,
}: {
  service: ServiceName;
  status?: ServiceSetupStatus;
  loading: boolean;
  onApiKey: () => void;
}) {
  const copy = SERVICE_COPY[service];
  const connected = status?.configured ?? false;
  const detail = useCredentialDetail(status, loading);

  return (
    <section className="border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex h-9 items-center">
            <ServiceBrand service={service} />
          </div>
          <p className="mt-2 text-sm text-muted">{detail}</p>
        </div>
        <StatusLabel connected={connected} loading={loading} />
      </div>

      <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/80">
        {copy.description}
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={onApiKey}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90"
        >
          <KeyRound className="size-4" />
          {connected ? "Update key" : "Add API key"}
        </button>
        <a
          href={copy.helperHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {copy.helperLabel} {copy.helperDescription}
          <ExternalLink className="size-4 shrink-0" />
        </a>
      </div>
    </section>
  );
}

function ServiceBrand({ service }: { service: ServiceName }) {
  if (service === "tinyfish") {
    return (
      <>
        <img
          src="https://www.tinyfish.ai/TF-Logos/Horizontal%20Logo/SVG/TF_Horizontal.svg"
          alt="TinyFish"
          className="h-8 w-auto dark:hidden"
        />
        <img
          src="/logos/engines/tinyfish-wordmark-dark.svg"
          alt="TinyFish"
          className="hidden h-8 w-auto dark:block"
        />
      </>
    );
  }

  if (service === "orcarouter") {
    return <OrcaRouterBrand />;
  }

  return <OpenRouterBrand />;
}

function OpenRouterBrand() {
  return (
    <div className="flex items-center gap-2 text-black dark:invert">
      <svg
        width="24"
        height="24"
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
          strokeWidth="90"
        />
        <path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" />
        <path
          d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
          strokeWidth="90"
        />
        <path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" />
      </svg>
      <span className="text-xl font-semibold tracking-tight">OpenRouter</span>
    </div>
  );
}

function OrcaRouterBrand() {
  return (
    <div className="flex items-center gap-2 text-black dark:invert">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1-4-4 4 4 0 0 1 4-4 4 4 0 0 1 4-4Z" />
        <circle cx="12" cy="12" r="2" fill="var(--color-surface, #fff)" />
      </svg>
      <span className="text-xl font-semibold tracking-tight">OrcaRouter</span>
    </div>
  );
}

function StatusLabel({
  connected,
  loading,
}: {
  connected: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
        <Loader2 className="size-4 animate-spin" />
        Checking
      </span>
    );
  }

  if (!connected) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
      <CheckCircle2 className="size-4" />
      Connected
    </span>
  );
}

function useCredentialDetail(
  status: ServiceSetupStatus | undefined,
  loading: boolean,
) {
  return useMemo(() => {
    if (loading) return "Checking connection...";
    if (!status?.configured) return "Not connected";
    if (status.connectionMethod === "oauth") return "Connected through OAuth";
    if (status.source === "env") return "Connected through .env";
    return "Connected through API key";
  }, [loading, status?.configured, status?.connectionMethod, status?.source]);
}

function ApiKeyModal({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceName;
  onClose: () => void;
  onSaved: (status: LocalSetupStatus) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = SERVICE_COPY[service];
  const isTinyFish = service === "tinyfish";

  async function handleSubmit() {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = isTinyFish
        ? await saveTinyFishApiKey(apiKey.trim())
        : service === "orcarouter"
          ? await saveOrcaRouterApiKey(apiKey.trim())
          : await saveOpenRouterApiKey(apiKey.trim());
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{copy.modalTitle}</h2>
            <p className="mt-1 text-xs text-muted">{copy.modalDescription}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-foreground/[0.05] hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block text-xs font-medium text-muted">
            API key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              autoFocus
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30"
              placeholder={copy.inputPlaceholder}
            />
          </label>

          {error && (
            <div className="border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <a
              href={copy.helperHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
            >
              Get a key
              <ExternalLink className="size-3" />
            </a>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!apiKey.trim() || saving}
              className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2 text-xs font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Verify and save to keychain
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
