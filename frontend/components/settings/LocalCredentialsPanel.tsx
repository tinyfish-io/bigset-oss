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
  saveLlmProviderConfig,
  saveTinyFishApiKey,
  type LlmProviderType,
  type LocalSetupStatus,
  type ServiceSetupStatus,
} from "@/lib/backend";
import { isLocalMode } from "@/lib/app-mode";
import {
  LlmProviderBrand,
  LlmProviderSelector,
  displayBaseUrl,
  llmProviderLabelForStatus,
  llmProviderOption,
  localLlmPresetForBaseUrl,
  type LlmProviderOptionValue,
} from "@/components/settings/llm-providers";
import {
  beginOpenRouterOAuth,
  useCanUseOpenRouterOAuth,
} from "@/lib/openrouter-oauth";

type ServiceName = "tinyfish" | "llm";

type ServiceCopy = {
  modalTitle: string;
  description: string;
  inputPlaceholder: string;
  modalDescription: string;
  helperHref?: string;
  helperLabel: string;
  helperDescription: string;
};

const SERVICE_COPY: Record<ServiceName, ServiceCopy> = {
  tinyfish: {
    modalTitle: "Connect TinyFish",
    description:
      "Connect TinyFish for live search and source pages.",
    inputPlaceholder: "tf_...",
    modalDescription: "BigSet verifies the key and stores it in your OS keychain.",
    helperHref:
      "https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2",
    helperLabel: "Get your TinyFish API Key",
    helperDescription: "",
  },
  llm: {
    modalTitle: "Model provider",
    description:
      "Choose the provider BigSet uses for schema generation and agents.",
    inputPlaceholder: "API key",
    modalDescription:
      "Select a provider. BigSet stores local credentials in your OS keychain.",
    helperLabel: "",
    helperDescription: "",
  },
};

export function LocalCredentialsPanel({
  onStatusChange,
}: {
  onStatusChange?: (status: LocalSetupStatus) => void;
} = {}) {
  const [status, setStatus] = useState<LocalSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ServiceName | null>(null);

  useEffect(() => {
    if (!isLocalMode) return;

    let active = true;
    getLocalSetupStatus()
      .then((next) => {
        if (active) {
          setStatus(next);
          onStatusChange?.(next);
        }
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
  }, [onStatusChange]);

  if (!isLocalMode) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 max-w-2xl">
        <h2 className="text-sm font-semibold text-foreground">
          Service credentials
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Add TinyFish and your preferred LLM provider for live datasets. Local
          keys stay in your OS keychain.
        </p>
      </div>

      {loadError ? (
        <div className="border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <CredentialCard
            service="tinyfish"
            status={status?.services.tinyfish}
            loading={loading}
            onApiKey={() => setModal("tinyfish")}
          />
          <CredentialCard
            service="llm"
            status={status?.services.llm}
            loading={loading}
            onApiKey={() => setModal("llm")}
          />
        </div>
      )}

      {modal && (
        <ApiKeyModal
          service={modal}
          status={status}
          onClose={() => setModal(null)}
          onSaved={(next) => {
            setStatus(next);
            onStatusChange?.(next);
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
  const primaryLabel =
    service === "llm"
      ? connected
        ? "Update provider"
        : "Choose provider"
      : connected
        ? "Update key"
        : "Add API key";

  return (
    <section className="flex min-h-[290px] flex-col border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex h-9 items-center">
            <ServiceBrand
              service={service}
              provider={connected ? status?.provider : undefined}
              baseUrl={connected ? status?.baseUrl : undefined}
            />
          </div>
          <p className="mt-2 text-sm text-muted">{detail}</p>
        </div>
        <StatusLabel connected={connected} loading={loading} />
      </div>

      <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/80">
        {copy.description}
      </p>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <button
          type="button"
          onClick={onApiKey}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90"
        >
          <KeyRound className="size-4" />
          {primaryLabel}
        </button>
        {copy.helperHref && copy.helperLabel ? (
          <a
            href={copy.helperHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {copy.helperLabel}
            {copy.helperDescription ? ` ${copy.helperDescription}` : null}
            <ExternalLink className="size-4 shrink-0" />
          </a>
        ) : copy.helperLabel ? (
          <p className="text-sm leading-6 text-muted">
            <span className="font-semibold text-foreground">
              {copy.helperLabel}:
            </span>{" "}
            {copy.helperDescription}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ServiceBrand({
  service,
  provider,
  baseUrl,
}: {
  service: ServiceName;
  provider?: LlmProviderType;
  baseUrl?: string;
}) {
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

  return <LlmProviderBrand provider={provider} baseUrl={baseUrl} />;
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
    const llmLabel = llmProviderLabelForStatus(status);
    if (llmLabel) return llmLabel;
    if (status.connectionMethod === "oauth") return "Connected through OAuth";
    if (status.source === "env") return "Connected through .env";
    return "Connected through API key";
  }, [loading, status]);
}

function ApiKeyModal({
  service,
  status,
  onClose,
  onSaved,
}: {
  service: ServiceName;
  status: LocalSetupStatus | null;
  onClose: () => void;
  onSaved: (status: LocalSetupStatus) => void;
}) {
  const initialProvider = initialLlmProviderSelection(status);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] =
    useState<LlmProviderOptionValue>(initialProvider);
  const [baseUrl, setBaseUrl] = useState(() =>
    initialBaseUrl(status, initialProvider),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = SERVICE_COPY[service];
  const isTinyFish = service === "tinyfish";
  const providerCopy = llmProviderOption(provider);
  const providerStatuses = status?.services.llmProviders;
  const resolvedProvider = providerCopy.provider;
  const selectedProviderStatus = providerStatuses?.[resolvedProvider];
  const selectedProviderConfigured =
    selectedProviderStatus?.configured ??
    (status?.services.llm.configured &&
      status.services.llm.provider === resolvedProvider) ??
    false;
  const selectedRequiresBaseUrl = providerCopy.requiresBaseUrl ?? false;
  const selectedRequiresApiKey = providerCopy.requiresApiKey ?? resolvedProvider !== "custom";
  const selectedUsesPresetBaseUrl = !!providerCopy.defaultBaseUrl;
  const showOpenRouterOAuth = useCanUseOpenRouterOAuth();
  const isCustomEndpoint = provider === "custom";

  function handleProviderChange(next: LlmProviderOptionValue) {
    setProvider(next);
    setBaseUrl(initialBaseUrl(status, next));
    setApiKey("");
    setError(null);
  }

  async function handleSubmit() {
    if (saving) return;
    if (isTinyFish && !apiKey.trim()) return;
    if (!isTinyFish && selectedRequiresApiKey && !apiKey.trim() && !selectedProviderConfigured) {
      return;
    }
    if (!isTinyFish && selectedRequiresBaseUrl && !baseUrl.trim() && !selectedProviderConfigured) {
      setError("Custom providers require a base URL");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const next = isTinyFish
        ? await saveTinyFishApiKey(apiKey.trim())
        : await saveLlmProviderConfig({
            provider: resolvedProvider,
            apiKey:
              selectedRequiresApiKey || provider === "custom"
                ? apiKey.trim()
                : "",
            defaultModel: providerCopy.defaultModel,
            baseUrl:
              selectedRequiresBaseUrl && baseUrl.trim()
                ? baseUrl.trim()
                : undefined,
          });
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSaving(false);
    }
  }

  const helperHref = isTinyFish ? copy.helperHref : providerCopy.helperHref;
  const helperLabel = isTinyFish
    ? "Get your TinyFish API Key"
    : isCustomEndpoint
      ? "OpenAI API docs"
      : selectedRequiresBaseUrl
      ? "Provider docs"
      : "Get a key";
  const showApiKeyHelper =
    !!helperHref && (isTinyFish || selectedRequiresApiKey);
  const canSubmit =
    !saving &&
    (isTinyFish
      ? !!apiKey.trim()
      : selectedRequiresBaseUrl
        ? !!baseUrl.trim() || selectedProviderConfigured
        : !selectedRequiresApiKey || !!apiKey.trim() || selectedProviderConfigured);
  const usingSavedProvider =
    !isTinyFish &&
    selectedProviderConfigured &&
    !apiKey.trim() &&
    (!selectedRequiresBaseUrl ||
      !baseUrl.trim() ||
      baseUrl.trim() === displayBaseUrl(selectedProviderStatus?.baseUrl));

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
        className={`relative flex w-full max-w-3xl flex-col border border-border bg-surface shadow-2xl ${
          isTinyFish ? "max-h-[90vh]" : "h-[calc(100vh-2rem)] max-h-[760px]"
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{copy.modalTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {copy.modalDescription}
            </p>
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {!isTinyFish && (
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">
                Provider
              </legend>
              <LlmProviderSelector
                value={provider}
                onChange={handleProviderChange}
              />
            </fieldset>
          )}

          {!isTinyFish && provider === "openrouter" && showOpenRouterOAuth && (
            <div className="flex flex-col gap-3 border border-border bg-background/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  OpenRouter OAuth
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Connect through OpenRouter without pasting a key.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void beginOpenRouterOAuth(currentReturnPath())}
                className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/[0.04]"
              >
                Connect with OAuth
              </button>
            </div>
          )}

          {!isTinyFish && selectedRequiresBaseUrl && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="settings-provider-base-url"
                  className="text-sm font-medium text-foreground"
                >
                  Base URL
                </label>
                {helperHref && (
                  <a
                    href={helperHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
                  >
                    {helperLabel}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <input
                id="settings-provider-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-foreground/30"
                placeholder={providerCopy.defaultBaseUrl ?? "http://localhost:1234/v1"}
              />
              <span className="mt-1 block text-xs leading-5 text-muted">
                {selectedUsesPresetBaseUrl
                  ? "Default local endpoint. Change it only if your server uses another port."
                  : "Use the OpenAI-compatible `/v1` endpoint for local or experimental providers."}
              </span>
            </div>
          )}

          {(isTinyFish || selectedRequiresApiKey || provider === "custom") && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="settings-provider-api-key"
                  className="text-sm font-medium text-foreground"
                >
                  API key{!isTinyFish && resolvedProvider === "custom" ? " (optional)" : ""}
                </label>
                {showApiKeyHelper && (
                  <a
                    href={helperHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
                  >
                    {helperLabel}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <input
                id="settings-provider-api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                autoFocus={isTinyFish}
                disabled={!isTinyFish && !selectedRequiresApiKey && provider !== "custom"}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={isTinyFish ? copy.inputPlaceholder : providerCopy.apiKeyPlaceholder}
              />
            </div>
          )}

          {error && (
            <div className="border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-border bg-surface px-5 py-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2 text-xs font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {usingSavedProvider ? "Use saved provider" : "Verify and save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialLlmProviderSelection(
  status: LocalSetupStatus | null,
): LlmProviderOptionValue {
  if (status?.services.llm.configured && status.services.llm.provider) {
    if (status.services.llm.provider === "custom") {
      return (
        localLlmPresetForBaseUrl(status.services.llm.baseUrl)?.value ?? "custom"
      );
    }
    return status.services.llm.provider;
  }

  const savedProvider = (Object.entries(status?.services.llmProviders ?? {}) as [
    LlmProviderType,
    ServiceSetupStatus,
  ][]).find(([, providerStatus]) => providerStatus.configured)?.[0];

  if (savedProvider === "custom") {
    return (
      localLlmPresetForBaseUrl(status?.services.llmProviders?.custom?.baseUrl)
        ?.value ?? "custom"
    );
  }

  return savedProvider ?? "openrouter";
}

function initialBaseUrl(
  status: LocalSetupStatus | null,
  provider: LlmProviderOptionValue,
) {
  const option = llmProviderOption(provider);
  const activeStatus = status?.services.llm;
  const activeSelection =
    activeStatus?.provider === "custom"
      ? (localLlmPresetForBaseUrl(activeStatus.baseUrl)?.value ?? "custom")
      : activeStatus?.provider;
  const providerStatus =
    status?.services.llmProviders?.[option.provider] ??
    (activeSelection === provider ? activeStatus : undefined);
  const savedBaseUrl = displayBaseUrl(
    providerStatus?.baseUrl,
  );
  if (option.defaultBaseUrl) return savedBaseUrl || option.defaultBaseUrl;
  if (option.provider === "custom") {
    return savedBaseUrl;
  }
  return "";
}

function currentReturnPath() {
  if (typeof window === "undefined") return "/setup";
  return `${window.location.pathname}${window.location.search}`;
}
