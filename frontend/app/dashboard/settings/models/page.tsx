"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getModelConfig, saveModelConfig, getOpenRouterModels, refreshOpenRouterModels, type EffectiveModelConfig, type OpenRouterModel } from "@/lib/backend";
import { SettingsPageLayout } from "@/components/settings/SettingsPageLayout";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsTile } from "@/components/settings/SettingsTile";
import { LocalCredentialsPanel } from "@/components/settings/LocalCredentialsPanel";
import { ModelSideSheet } from "@/components/settings/ModelSideSheet";
import { MODEL_ROLES, type ModelRole } from "@/components/settings/types";
import { SkeletonList } from "@/components/settings/Skeleton";
import { useAppAuth } from "@/lib/app-auth";

export default function ModelSettingsPage() {
  const { getToken } = useAppAuth();
  const convexModels = useQuery(api.openRouterModels.list, {});

  const [effectiveConfig, setEffectiveConfig] = useState<EffectiveModelConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetModels, setSheetModels] = useState<OpenRouterModel[]>([]);
  const [activeSheet, setActiveSheet] = useState<{ role: ModelRole } | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);

  const isLoading = convexModels === undefined || isLoadingConfig;

  useEffect(() => {
    getToken()
      .then((token) => {
        if (!token) throw new Error("Not authenticated");
        return getModelConfig(token);
      })
      .then((config) => setEffectiveConfig(config))
      .catch(() => setEffectiveConfig(null))
      .finally(() => setIsLoadingConfig(false));
  }, [getToken]);

  const models: OpenRouterModel[] = convexModels
    ? convexModels.map((m) => ({
        modelName: m.modelName,
        canonicalSlug: m.canonicalSlug,
        contextLength: m.contextLength,
        completionCost: m.completionCost,
        promptCost: m.promptCost,
      }))
    : [];

  function getSelectedModel(role: ModelRole): string {
    return effectiveConfig?.[role.key as keyof typeof effectiveConfig] ?? "";
  }

  async function handleModelSelect(role: ModelRole, model: OpenRouterModel) {
    setIsSavingModel(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await saveModelConfig({ [role.key]: model.canonicalSlug }, token);
      setEffectiveConfig((prev: EffectiveModelConfig | null) =>
        prev ? { ...prev, [role.key]: model.canonicalSlug } : null
      );
      setActiveSheet(null);
    } catch {
      // we will add toast later
    } finally {
      setIsSavingModel(false);
    }
  }

  function openSideSheet(role: ModelRole) {
    if (sheetModels.length === 0) {
      getOpenRouterModels()
        .then((models) => setSheetModels(models))
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

  return (
    <SettingsPageLayout navItems={navItems}>
      <div className="w-full max-w-4xl">
        <LocalCredentialsPanel />

        <SettingsHeader
          title="Model Settings"
          subtitle="Configure AI models for different tasks. Models are fetched from OpenRouter."
        />

        <div className="space-y-2">
          {isLoading ? (
            <SkeletonList count={MODEL_ROLES.length} />
          ) : (
            MODEL_ROLES.map((role) => (
              <SettingsTile
                key={role.key}
                label={role.label}
                description={role.description}
                value={getSelectedModel(role)}
                onClick={() => openSideSheet(role)}
              />
            ))
          )}
        </div>
      </div>

      {activeSheet && (
        <ModelSideSheet
          open={true}
          onClose={() => !isSavingModel && setActiveSheet(null)}
          title={`Select ${activeSheet.role.label} Model`}
          selectedModel={getSelectedModel(activeSheet.role)}
          models={sheetModels.length > 0 ? sheetModels : models}
          onSelect={(slug) => {
            const sourceModels = sheetModels.length > 0 ? sheetModels : models;
            const model = sourceModels.find((m) => m.canonicalSlug === slug);
            if (model) handleModelSelect(activeSheet.role, model);
          }}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              const token = await getToken();
              if (!token) throw new Error("Not authenticated");
              const models = await refreshOpenRouterModels(token);
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
