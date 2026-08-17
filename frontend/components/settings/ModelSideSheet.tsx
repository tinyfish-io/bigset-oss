"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X, Search, RefreshCw } from "lucide-react";
import type { OpenRouterModel } from "./types";

interface ModelSideSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  selectedModel: string;
  models: OpenRouterModel[];
  onSelect: (modelSlug: string) => void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  isSaving?: boolean;
  error?: string | null;
}

function groupModelsByProvider(models: OpenRouterModel[]): Record<string, OpenRouterModel[]> {
  const groups: Record<string, OpenRouterModel[]> = {};
  for (const model of models) {
    const provider = model.canonicalSlug.split("/")[0] || "Other";
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(model);
  }
  return groups;
}

function SkeletonItem() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="size-4 rounded-full border-2 border-foreground/10" />
      <div className="min-w-0 flex-1">
        <div className="h-3 w-24 rounded bg-foreground/5 animate-pulse mb-1" />
        <div className="h-2 w-32 rounded bg-foreground/5 animate-pulse" />
      </div>
      <div className="w-16 h-3 rounded bg-foreground/5 animate-pulse hidden sm:block" />
    </div>
  );
}

function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div className="py-2">
      {["Loading", "Models", "Please Wait"].map((_, i) => (
        <div key={i} className="mb-4">
          <div className="px-4 py-2">
            <div className="h-2 w-16 rounded bg-foreground/5 animate-pulse" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: count }).map((_, j) => (
              <SkeletonItem key={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModelSideSheet({
  open,
  onClose,
  title,
  selectedModel,
  models,
  onSelect,
  onRefresh,
  isRefreshing,
  isSaving,
  error,
}: ModelSideSheetProps) {
  const [search, setSearch] = useState("");
  const [customSlug, setCustomSlug] = useState(selectedModel);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const filteredModels = search.trim()
    ? models.filter(
        (m) =>
          m.modelName.toLowerCase().includes(search.toLowerCase()) ||
          m.canonicalSlug.toLowerCase().includes(search.toLowerCase()),
      )
    : models;

  const groupedModels = groupModelsByProvider(filteredModels);
  const providers = Object.keys(groupedModels).sort();
  const customSlugValue = customSlug.trim();

  useEffect(() => {
    if (open) {
      const focusTimer = setTimeout(() => {
        inputRef.current?.focus();
        if (!inputRef.current) {
          customInputRef.current?.focus();
        }
      }, 100);
      return () => clearTimeout(focusTimer);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    const panel = panelRef.current;
    panel.addEventListener("keydown", handleKey);
    return () => panel.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleCustomSlugSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!customSlugValue || isSaving) return;
    onSelect(customSlugValue);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative w-full lg:w-[40%] h-full bg-surface border-l border-border shadow-2xl flex flex-col animate-slide-in"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing || isSaving}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
                aria-label="Refresh models"
              >
                <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </button>
            )}
            <button
              onClick={onClose}
              disabled={isSaving}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
          {models.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
          )}
          <form onSubmit={handleCustomSlugSubmit} className="flex items-center gap-2">
            <input
              ref={customInputRef}
              type="text"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="Custom model slug"
              aria-label="Custom model slug"
              disabled={isSaving}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:font-sans placeholder:text-muted outline-none focus:border-foreground/30 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!customSlugValue || isSaving}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-foreground/5 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <Check className="size-4" />
              Use
            </button>
          </form>
          {error && (
            <p role="alert" className="text-xs text-red-500">
              {error}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isRefreshing ? (
            <SkeletonList count={5} />
          ) : providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted">No models found</p>
            </div>
          ) : (
            <div className="py-2">
              <div className="flex items-center gap-3 px-5 py-1.5 border-b border-border mb-2">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Model</span>
                </div>
                <div className="shrink-0 text-right w-16">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Context</span>
                </div>
                <div className="shrink-0 text-right w-14">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Input</span>
                </div>
                <div className="shrink-0 text-right w-14">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Output</span>
                </div>
              </div>
              {providers.map((provider) => (
                <div key={provider} className="mb-4">
                  <div className="px-4 py-2">
                    <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                      {provider}
                    </h3>
                  </div>
                  <div className="px-2">
                    {groupedModels[provider].map((model) => {
                      const isSelected = model.canonicalSlug === selectedModel;
                      return (
                        <button
                          key={model.canonicalSlug}
                          onClick={() => onSelect(model.canonicalSlug)}
                          disabled={isSaving}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors disabled:opacity-50 ${
                            isSelected
                              ? "bg-foreground/5"
                              : "hover:bg-foreground/2"
                          }`}
                        >
                          <div
                            className={`size-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                              isSelected
                                ? "border-foreground bg-foreground"
                                : "border-muted/30"
                            }`}
                          >
                            {isSelected && (
                              <div className="size-2 rounded-full bg-surface" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {model.modelName}
                            </p>
                            <p className="text-[11px] text-muted font-mono truncate">
                              {model.canonicalSlug}
                            </p>
                          </div>
                          <div className="text-right shrink-0 w-16">
                            <p className="text-[11px] text-muted">
                              {model.contextLength > 0
                                ? model.contextLength >= 1000
                                  ? `${(model.contextLength / 1000).toLocaleString()}K`
                                  : model.contextLength.toLocaleString()
                                : "—"}
                            </p>
                          </div>
                          <div className="text-right shrink-0 w-14">
                            <p className="text-[11px] text-muted">
                              {model.promptCost > 0 ? `$${model.promptCost.toFixed(2)}/1M` : "—"}
                            </p>
                          </div>
                          <div className="text-right shrink-0 w-14">
                            <p className="text-[11px] text-muted">
                              {model.completionCost > 0 ? `$${model.completionCost.toFixed(2)}/1M` : "—"}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border shrink-0">
          <p className="text-[11px] text-muted text-center">
            {isSaving ? "Saving..." : isRefreshing ? "Refreshing..." : `${filteredModels.length} models available`}
          </p>
        </div>
      </div>
    </div>
  );
}
