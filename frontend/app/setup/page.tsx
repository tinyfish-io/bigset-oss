"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  X,
} from "lucide-react";
import {
  getLocalSetupStatus,
  getLlmProviderModels,
  getModelConfig,
  saveLlmProviderConfig,
  saveModelConfig,
  saveTinyFishApiKey,
  type EffectiveModelConfig,
  type EffectiveModelRole,
  type ReasoningLevel,
  type LlmProviderType,
  type LocalSetupStatus,
  type OpenRouterModel,
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
import { LocalUtilityMenu } from "@/components/LocalUtilityMenu";
import { ModelSideSheet } from "@/components/settings/ModelSideSheet";
import { MODEL_ROLES, type ModelRole } from "@/components/settings/types";
import { ReasoningControl } from "@/components/settings/ReasoningControl";
import { useAppAuth } from "@/lib/app-auth";

function modelListCacheKey(status: LocalSetupStatus | null): string {
  const llm = status?.services.llm;
  if (!llm) return "";
  return [
    llm.provider ?? "openrouter",
    llm.baseUrl ?? "",
    llm.defaultModel ?? "",
    llm.verifiedAt ?? "",
  ].join("|");
}

function emptyModelRole(): EffectiveModelRole {
  return { model: "", reasoning: "medium", reasoningOverridden: false };
}

function emptyModelConfig(): EffectiveModelConfig {
  return {
    schemaInference: emptyModelRole(),
    populateOrchestrator: emptyModelRole(),
    investigateSubagent: emptyModelRole(),
  };
}

export default function SetupPage() {
  const router = useRouter();
  const { getToken } = useAppAuth();
  const [status, setStatus] = useState<LocalSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"tinyfish" | "llm" | null>(null);
  const [modelConfig, setModelConfig] = useState<EffectiveModelConfig | null>(
    null,
  );
  const [loadingModelConfig, setLoadingModelConfig] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [activeModelRole, setActiveModelRole] = useState<ModelRole | null>(null);
  const [modelOptions, setModelOptions] = useState<OpenRouterModel[]>([]);
  const [modelOptionsCacheKey, setModelOptionsCacheKey] = useState<
    string | null
  >(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [reasoningSupported, setReasoningSupported] = useState(true);
  const [savingReasoningRole, setSavingReasoningRole] = useState<string | null>(null);
  const [modelConfigReloadKey, setModelConfigReloadKey] = useState(0);
  const activeModelListCacheKeyRef = useRef("");

  useEffect(() => {
    if (!isLocalMode) {
      router.replace("/dashboard");
      return;
    }

    getLocalSetupStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, [router]);

  const activeModelListCacheKey = modelListCacheKey(status);

  useEffect(() => {
    activeModelListCacheKeyRef.current = activeModelListCacheKey;
  }, [activeModelListCacheKey]);

  useEffect(() => {
    let active = true;

    if (!status?.services.llm.configured) return;

    async function loadModelConfig() {
      setLoadingModelConfig(true);
      setModelError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const settings = await getModelConfig(token);
        if (!active) return;
        setModelConfig(settings.config);
        setReasoningSupported(settings.reasoningSupported);
      } catch (err) {
        if (!active) return;
        setModelConfig(emptyModelConfig());
        setModelError(
          err instanceof Error ? err.message : "Failed to load model settings",
        );
      } finally {
        if (active) setLoadingModelConfig(false);
      }
    }

    void loadModelConfig();

    return () => {
      active = false;
    };
  }, [
    getToken,
    modelConfigReloadKey,
    status?.services.llm.baseUrl,
    status?.services.llm.configured,
    status?.services.llm.provider,
    status?.services.llm.verifiedAt,
  ]);

  const loadProviderModels = useCallback(
    async (force = false) => {
      const cacheKey = activeModelListCacheKeyRef.current;
      if (!force && modelOptionsCacheKey === cacheKey && modelOptions.length > 0) {
        return;
      }

      setRefreshingModels(true);
      setModelError(null);
      try {
        const models = await getLlmProviderModels();
        if (activeModelListCacheKeyRef.current !== cacheKey) return;
        setModelOptions(models);
        setModelOptionsCacheKey(cacheKey);
      } catch (err) {
        if (activeModelListCacheKeyRef.current !== cacheKey) return;
        setModelOptions([]);
        setModelOptionsCacheKey(cacheKey);
        setModelError(
          err instanceof Error ? err.message : "Failed to load models",
        );
      } finally {
        if (activeModelListCacheKeyRef.current === cacheKey) {
          setRefreshingModels(false);
        }
      }
    },
    [modelOptions.length, modelOptionsCacheKey],
  );

  function modelForRole(role: ModelRole): string {
    const key = role.key as keyof EffectiveModelConfig;
    return modelConfig?.[key]?.model ?? "";
  }

  function openModelSheet(role: ModelRole) {
    setActiveModelRole(role);
    void loadProviderModels();
  }

  async function saveModelForRole(role: ModelRole, modelId: string) {
    const nextModelId = modelId.trim();
    if (!nextModelId) return;

    const key = role.key as keyof EffectiveModelConfig;
    setSavingModel(true);
    setModelError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await saveModelConfig({ [key]: nextModelId }, token);
      setModelConfig((prev) => ({
        ...emptyModelConfig(),
        ...prev,
        [key]: { ...(prev?.[key] ?? emptyModelRole()), model: nextModelId },
      }));
      setActiveModelRole(null);
      // A different model can change the auto-resolved reasoning level, so let
      // the server recompute rather than leaving the previous model's level.
      setModelConfigReloadKey((current) => current + 1);
    } catch (err) {
      setModelError(
        err instanceof Error ? err.message : "Failed to save model",
      );
    } finally {
      setSavingModel(false);
    }
  }

  /**
   * Persist a reasoning level for one role. `null` clears the override so the
   * role returns to the provider/role default — sent explicitly, since an
   * omitted field means "leave unchanged".
   */
  async function saveReasoningForRole(
    role: ModelRole,
    level: ReasoningLevel | null,
  ) {
    const key = role.key as keyof EffectiveModelConfig;
    const previous = modelConfig;
    setSavingReasoningRole(role.key);
    setModelError(null);
    setModelConfig((prev) =>
      prev
        ? {
            ...prev,
            [key]: {
              ...prev[key],
              ...(level ? { reasoning: level } : {}),
              reasoningOverridden: level !== null,
            },
          }
        : prev,
    );
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await saveModelConfig({ [`${key}Reasoning`]: level }, token);
      // Clearing needs the server's recomputed default, which we can't derive.
      if (level === null) setModelConfigReloadKey((current) => current + 1);
    } catch (err) {
      setModelConfig(previous);
      setModelError(
        err instanceof Error ? err.message : "Failed to save reasoning effort",
      );
    } finally {
      setSavingReasoningRole(null);
    }
  }

  const complete = status?.complete ?? false;
  const modelSelectionRequired =
    !!status?.services.llm.configured && !status.services.llm.defaultModel;
  const modelsConfigured =
    !modelSelectionRequired ||
    MODEL_ROLES.every((role) => modelForRole(role).trim().length > 0);
  const canCompleteSetup = complete && modelsConfigured;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <div>
          <img src="/BigSetLogo.png" alt="BigSet" className="h-[30px] dark:hidden" />
          <img src="/BigSetLogoDarkBG.png" alt="BigSet" className="h-[30px] hidden dark:block" />
        </div>
        <LocalUtilityMenu showSettingsLink={false} />
      </header>

      <main className="flex-1 px-5 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-8 max-w-2xl">
            <h1 className="text-[32px] font-bold leading-none tracking-tight sm:text-[38px]">
              Connect your services
            </h1>
            <p className="mt-3 text-base leading-7 text-muted">
              Add TinyFish and choose where BigSet should run model calls.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ServiceCard
              brand={
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
              }
              description="Connect TinyFish for live search and source pages."
              status={status?.services.tinyfish}
              primaryLabel={
                status?.services.tinyfish.configured ? "Update key" : "Add API key"
              }
              onPrimary={() => setModal("tinyfish")}
              helperHref="https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2"
              helperLabel="Get your TinyFish API Key"
            />

            <ServiceCard
              brand={
                <LlmProviderBrand
                  provider={
                    status?.services.llm.configured
                      ? status.services.llm.provider
                      : undefined
                  }
                  baseUrl={status?.services.llm.baseUrl}
                />
              }
              description="Choose the provider BigSet uses for schema generation and agents."
              status={status?.services.llm}
              primaryLabel={
                status?.services.llm.configured
                  ? "Update provider"
                  : "Choose provider"
              }
              onPrimary={() => setModal("llm")}
            />
          </div>

          {status?.services.llm.configured && (
            <section className="mt-4 border border-border bg-surface">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Models
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {llmProviderLabelForStatus(status.services.llm) ??
                      "Model provider"}
                  </p>
                </div>
                {modelSelectionRequired && !modelsConfigured && (
                  <span className="text-xs font-medium text-muted">
                    Required
                  </span>
                )}
              </div>
              <div className="divide-y divide-border">
                {MODEL_ROLES.map((role) => {
                  const selectedModel = modelForRole(role);
                  const roleConfig =
                    modelConfig?.[role.key as keyof EffectiveModelConfig] ?? null;
                  return (
                    <div key={role.key}>
                      <button
                        type="button"
                        onClick={() => openModelSheet(role)}
                        disabled={loadingModelConfig || savingModel}
                        className="flex w-full items-center justify-between gap-5 px-5 pt-4 pb-3 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-foreground">
                            {role.label}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-muted">
                            {role.description}
                          </span>
                        </span>
                        <span className="min-w-0 max-w-[45%] truncate text-right text-sm font-medium text-foreground">
                          {loadingModelConfig
                            ? "Loading..."
                            : selectedModel || "Choose model"}
                        </span>
                      </button>
                      {roleConfig && (
                        <div className="px-5">
                          <ReasoningControl
                            value={roleConfig.reasoning}
                            overridden={roleConfig.reasoningOverridden}
                            disabled={
                              savingModel || savingReasoningRole === role.key
                            }
                            unsupportedReason={
                              reasoningSupported
                                ? undefined
                                : "This provider doesn't expose a reasoning control, so effort is left to the model's own default."
                            }
                            onChange={(level) =>
                              void saveReasoningForRole(role, level)
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {modelError && (
                <div className="border-t border-red-500/30 bg-red-500/[0.06] px-5 py-3 text-xs text-red-700 dark:text-red-300">
                  {modelError}
                </div>
              )}
            </section>
          )}

          <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-muted sm:text-base">
              {complete && modelsConfigured
                ? "Everything is connected. You can start building datasets."
                : complete && modelSelectionRequired
                  ? "Choose models to continue."
                : "Complete both connections to continue."}
            </p>
            <button
              type="button"
              disabled={!canCompleteSetup}
              onClick={() => router.replace("/dashboard")}
              className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Complete setup
              <CheckCircle2 className="size-4" />
            </button>
          </div>
        </div>
      </main>

      {modal && (
        <ApiKeyModal
          service={modal}
          status={status}
          onClose={() => setModal(null)}
          onSaved={(next) => {
            setModelConfig(null);
            setModelOptions([]);
            setModelOptionsCacheKey(null);
            setModelError(null);
            setStatus(next);
            setModal(null);
          }}
        />
      )}

      {activeModelRole && (
        <ModelSideSheet
          open={true}
          onClose={() => !savingModel && setActiveModelRole(null)}
          title={`Select ${activeModelRole.label} Model`}
          selectedModel={modelForRole(activeModelRole)}
          models={modelOptions}
          onSelect={(slug) => saveModelForRole(activeModelRole, slug)}
          onRefresh={() => loadProviderModels(true)}
          isRefreshing={refreshingModels}
          isSaving={savingModel}
        />
      )}
    </div>
  );
}

function ServiceCard({
  brand,
  description,
  status,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  helperHref,
  helperLabel,
  helperDescription,
}: {
  brand: ReactNode;
  description: string;
  status?: ServiceSetupStatus;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  helperHref?: string;
  helperLabel?: string;
  helperDescription?: string;
}) {
  const connected = status?.configured ?? false;
  const detail = useMemo(() => {
    if (!connected) return "Not connected";
    const llmLabel = llmProviderLabelForStatus(status);
    if (llmLabel) return llmLabel;
    if (status?.connectionMethod === "oauth") return "Connected through OAuth";
    if (status?.source === "env") return "Connected through .env";
    return "Connected through API key";
  }, [connected, status]);

  return (
    <section className="flex min-h-[290px] flex-col border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex h-9 items-center">{brand}</div>
          <p className="mt-2 text-sm text-muted">{detail}</p>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4" />
            Connected
          </span>
        )}
      </div>

      <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/80">
        {description}
      </p>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrimary}
            className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text transition-opacity hover:opacity-90"
          >
            <KeyRound className="size-4" />
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-foreground/[0.04]"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
        {helperHref && helperLabel ? (
          <a
            href={helperHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {helperLabel}
            {helperDescription ? ` ${helperDescription}` : null}
            <ExternalLink className="size-4 shrink-0" />
          </a>
        ) : helperLabel ? (
          <p className="text-sm leading-6 text-muted">
            <span className="font-semibold text-foreground">{helperLabel}:</span>{" "}
            {helperDescription}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ApiKeyModal({
  service,
  status,
  onClose,
  onSaved,
}: {
  service: "tinyfish" | "llm";
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

  const helperHref = isTinyFish
    ? "https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2"
    : providerCopy.helperHref;
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
  const modalTitle = isTinyFish ? "TinyFish API key" : "Model provider";
  const modalDescription = isTinyFish
    ? "BigSet verifies the key and stores it in your OS keychain."
    : "Select a provider. BigSet stores local credentials in your OS keychain.";

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
            <h2 className="text-base font-semibold">{modalTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{modalDescription}</p>
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
                onClick={() => void beginOpenRouterOAuth("/setup")}
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
                  htmlFor="setup-provider-base-url"
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
                id="setup-provider-base-url"
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
                  htmlFor="setup-provider-api-key"
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
                id="setup-provider-api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                autoFocus={isTinyFish}
                disabled={!isTinyFish && !selectedRequiresApiKey && provider !== "custom"}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={isTinyFish ? "tf_..." : providerCopy.apiKeyPlaceholder}
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
