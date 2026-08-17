"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getLocalSetupStatus, getLlmProviderModels, getModelConfig, saveModelConfig, refreshOpenRouterModels, type EffectiveModelConfig, type LlmProviderType, type LocalSetupStatus, type OpenRouterModel, type ReasoningLevel } from "@/lib/backend";
import { SettingsPageLayout } from "@/components/settings/SettingsPageLayout";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsTile } from "@/components/settings/SettingsTile";
import { LocalCredentialsPanel } from "@/components/settings/LocalCredentialsPanel";
import { ModelSideSheet } from "@/components/settings/ModelSideSheet";
import { MODEL_ROLES, type ModelRole } from "@/components/settings/types";
import { ReasoningControl } from "@/components/settings/ReasoningControl";
import { SkeletonList } from "@/components/settings/Skeleton";
import { useAppAuth } from "@/lib/app-auth";
import { isLocalMode } from "@/lib/app-mode";

function modelListCacheKey(status: LocalSetupStatus): string {
  const llm = status.services.llm;
  return [
    llm.provider ?? "openrouter",
    llm.baseUrl ?? "",
    llm.defaultModel ?? "",
    llm.verifiedAt ?? "",
  ].join("|");
}

export default function ModelSettingsPage() {
  const { getToken } = useAppAuth();
  const convexModels = useQuery(api.openRouterModels.list, {});

  const [effectiveConfig, setEffectiveConfig] = useState<EffectiveModelConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetModels, setSheetModels] = useState<OpenRouterModel[]>([]);
  const [sheetModelsCacheKey, setSheetModelsCacheKey] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<{ role: ModelRole } | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProviderType | null>(
    isLocalMode ? null : "openrouter",
  );
  const [activeModelListCacheKey, setActiveModelListCacheKey] = useState(
    isLocalMode ? "" : "openrouter|||",
  );
  const activeModelListCacheKeyRef = useRef(activeModelListCacheKey);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelConfigReloadKey, setModelConfigReloadKey] = useState(0);
  const [reasoningSupported, setReasoningSupported] = useState(true);
  const [savingReasoningRole, setSavingReasoningRole] = useState<string | null>(null);

  const needsOpenRouterCache = !isLocalMode || llmProvider === "openrouter";
  const isLoading =
    (needsOpenRouterCache && convexModels === undefined) ||
    isLoadingConfig ||
    (isLocalMode && llmProvider === null);

  const syncLlmProvider = useCallback((status: LocalSetupStatus) => {
    const nextCacheKey = modelListCacheKey(status);
    activeModelListCacheKeyRef.current = nextCacheKey;
    setLlmProvider(status.services.llm.provider ?? "openrouter");
    setActiveModelListCacheKey(nextCacheKey);
  }, []);

  const handleLocalCredentialsStatus = useCallback(
    (status: LocalSetupStatus) => {
      syncLlmProvider(status);
      setSheetModels([]);
      setSheetModelsCacheKey(null);
      setModelConfigReloadKey((key) => key + 1);
    },
    [syncLlmProvider],
  );

  useEffect(() => {
    let active = true;

    getToken()
      .then((token) => {
        if (!token) throw new Error("Not authenticated");
        return getModelConfig(token);
      })
      .then((settings) => {
        if (!active) return;
        setEffectiveConfig(settings.config);
        setReasoningSupported(settings.reasoningSupported);
      })
      .catch(() => {
        if (active) setEffectiveConfig(null);
      })
      .finally(() => {
        if (active) setIsLoadingConfig(false);
      });

    return () => {
      active = false;
    };
  }, [getToken, modelConfigReloadKey]);

  useEffect(() => {
    if (!isLocalMode) return;
    getLocalSetupStatus()
      .then(syncLlmProvider)
      .catch(() => setLlmProvider("openrouter"));
  }, [syncLlmProvider]);

  const models: OpenRouterModel[] = convexModels
    ? convexModels.map((m) => ({
        modelName: m.modelName,
        canonicalSlug: m.canonicalSlug,
        contextLength: m.contextLength,
        completionCost: m.completionCost,
        promptCost: m.promptCost,
      }))
    : [];
  const sideSheetModels =
    sheetModels.length > 0
      ? sheetModels
      : llmProvider === "openrouter"
        ? models
        : [];

  function getSelectedModel(role: ModelRole): string {
    return effectiveConfig?.[role.key as keyof typeof effectiveConfig]?.model ?? "";
  }

  function getRoleConfig(role: ModelRole) {
    return effectiveConfig?.[role.key as keyof typeof effectiveConfig] ?? null;
  }

  /**
   * Persist a reasoning level for one role. `null` clears the override so the
   * role goes back to the provider/role default, which is why the value is sent
   * explicitly rather than omitted — omitting a field means "leave unchanged".
   */
  async function saveReasoningForRole(
    role: ModelRole,
    level: ReasoningLevel | null,
  ) {
    const previous = effectiveConfig;
    setSavingReasoningRole(role.key);
    setSaveError(null);
    // Optimistic: the control should track the click, not the round-trip.
    setEffectiveConfig((prev) =>
      prev
        ? {
            ...prev,
            [role.key]: {
              ...prev[role.key as keyof typeof prev],
              ...(level ? { reasoning: level } : {}),
              reasoningOverridden: level !== null,
            },
          }
        : prev,
    );
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await saveModelConfig({ [`${role.key}Reasoning`]: level }, token);
      // Clearing needs the server's recomputed default, which we can't derive.
      if (level === null) setModelConfigReloadKey((key) => key + 1);
    } catch (err) {
      setEffectiveConfig(previous);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save reasoning effort.",
      );
    } finally {
      setSavingReasoningRole(null);
    }
  }

  async function saveModelForRole(role: ModelRole, modelId: string) {
    const nextModelId = modelId.trim();
    if (!nextModelId) return;

    setIsSavingModel(true);
    setSaveError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await saveModelConfig({ [role.key]: nextModelId }, token);
      setActiveSheet(null);
      // A new model can change the default reasoning level, so re-read rather
      // than patching the slug in place.
      setModelConfigReloadKey((key) => key + 1);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save model preference.",
      );
    } finally {
      setIsSavingModel(false);
    }
  }

  function openSideSheet(role: ModelRole) {
    setSaveError(null);
    const cacheKey = activeModelListCacheKeyRef.current || activeModelListCacheKey;
    if (sheetModels.length === 0 || sheetModelsCacheKey !== cacheKey) {
      setSheetModels([]);
      setSheetModelsCacheKey(cacheKey);
      getToken()
        .then((token) => getLlmProviderModels(token ?? undefined))
        .then((models) => {
          if (activeModelListCacheKeyRef.current !== cacheKey) return;
          setSheetModels(models);
          setSheetModelsCacheKey(cacheKey);
        })
        .catch(() => {
          // we will add toast later
        });
    }
    setActiveSheet({ role });
  }

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

  return (
    <SettingsPageLayout navItems={navItems}>
      <div className="w-full max-w-4xl">
        <LocalCredentialsPanel onStatusChange={handleLocalCredentialsStatus} />

        <SettingsHeader
          title="Model Settings"
          subtitle={
            llmProvider === "openrouter"
              ? "Configure AI models for different tasks. Models are fetched from OpenRouter."
              : "Configure AI models for different tasks. Models are fetched from your selected provider."
          }
        />

        <div className="space-y-3">
          {isLoading ? (
            <SkeletonList count={MODEL_ROLES.length} />
          ) : (
            MODEL_ROLES.map((role) => {
              const roleConfig = getRoleConfig(role);
              return (
                <div
                  key={role.key}
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  <SettingsTile
                    label={role.label}
                    description={role.description}
                    value={getSelectedModel(role)}
                    onClick={() => openSideSheet(role)}
                  />
                  {roleConfig && (
                    <>
                      <div className="mx-4 border-t border-border" />
                      <div className="px-4">
                        <ReasoningControl
                          value={roleConfig.reasoning}
                          overridden={roleConfig.reasoningOverridden}
                          disabled={savingReasoningRole === role.key}
                          unsupportedReason={
                            reasoningSupported
                              ? undefined
                              : "This provider doesn't expose a reasoning control, so effort is left to the model's own default."
                          }
                          onChange={(level) => void saveReasoningForRole(role, level)}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeSheet && (
        <ModelSideSheet
          open={true}
          onClose={() => {
            if (isSavingModel) return;
            setSaveError(null);
            setActiveSheet(null);
          }}
          error={saveError}
          title={`Select ${activeSheet.role.label} Model`}
          selectedModel={getSelectedModel(activeSheet.role)}
          models={sideSheetModels}
          onSelect={(slug) => saveModelForRole(activeSheet.role, slug)}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              const provider = llmProvider ?? "openrouter";
              const cacheKey = activeModelListCacheKeyRef.current || activeModelListCacheKey;
              let models: OpenRouterModel[];
              if (provider === "openrouter") {
                const token = await getToken();
                if (!token) throw new Error("Not authenticated");
                models = await refreshOpenRouterModels(token);
              } else {
                const token = await getToken();
                models = await getLlmProviderModels(token ?? undefined);
              }
              if (activeModelListCacheKeyRef.current !== cacheKey) return;
              setSheetModelsCacheKey(cacheKey);
              setSheetModels(models);
            } catch {
              // we will add toast later
            } finally {
              setRefreshing(false);
            }
          }}
          isRefreshing={refreshing}
          isSaving={isSavingModel}
        />
      )}
    </SettingsPageLayout>
  );
}
