"use client";

import { useState } from "react";
import { CircleHelp, Plug, TriangleAlert } from "lucide-react";
import type { LlmProviderType, ServiceSetupStatus } from "@/lib/backend";
import { OPENROUTER_DEFAULT_MODEL } from "@/lib/llm-provider-types";

type LlmProviderCategory = "direct" | "router" | "local" | "custom";
export type LlmProviderOptionValue = LlmProviderType;

export type LlmProviderOption = {
  value: LlmProviderOptionValue;
  provider: LlmProviderType;
  label: string;
  description: string;
  category: LlmProviderCategory;
  shortLabel: string;
  capability: string;
  authLabel: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  requiresBaseUrl?: boolean;
  requiresApiKey?: boolean;
  apiKeyPlaceholder: string;
  helperHref: string;
  iconSrc?: string;
  wordmarkSrc?: string;
};

export const LLM_PROVIDER_GROUPS: {
  categories: LlmProviderCategory[];
  label: string;
}[] = [
  {
    categories: ["router"],
    label: "Router",
  },
  {
    categories: ["direct"],
    label: "Direct",
  },
  {
    categories: ["local"],
    label: "Local",
  },
  {
    categories: ["custom"],
    label: "Custom",
  },
];

export const LLM_PROVIDER_OPTIONS: LlmProviderOption[] = [
  {
    value: "openai",
    provider: "openai",
    label: "OpenAI",
    description: "Use OpenAI models directly with your API key.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "gpt-5.6-sol",
    apiKeyPlaceholder: "sk-...",
    helperHref: "https://platform.openai.com/api-keys",
    iconSrc: "/logos/providers/openai-icon.svg",
    wordmarkSrc: "/logos/providers/openai.svg",
  },
  {
    value: "anthropic",
    provider: "anthropic",
    label: "Anthropic",
    description: "Use Claude models directly with your API key.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "claude-sonnet-5",
    apiKeyPlaceholder: "sk-ant-...",
    helperHref: "https://console.anthropic.com/settings/keys",
    iconSrc: "/logos/providers/anthropic-icon.svg",
    wordmarkSrc: "/logos/providers/anthropic.svg",
  },
  {
    value: "google",
    provider: "google",
    label: "Google Gemini",
    description: "Use Gemini models directly with your Google AI Studio API key.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "gemini-3.6-flash",
    apiKeyPlaceholder: "AIza...",
    helperHref: "https://aistudio.google.com/app/apikey",
    iconSrc: "/logos/providers/google-g.svg",
  },
  {
    value: "xai",
    provider: "xai",
    label: "xAI",
    description: "Use Grok models directly with your xAI API key.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "grok-4.5",
    apiKeyPlaceholder: "xai-...",
    helperHref: "https://console.x.ai/",
    iconSrc: "/logos/providers/xai.svg",
  },
  {
    value: "deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    description: "Use DeepSeek chat and reasoning models directly.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "deepseek-v4-flash",
    apiKeyPlaceholder: "sk-...",
    helperHref: "https://platform.deepseek.com/api_keys",
    iconSrc: "/logos/providers/deepseek.svg",
  },
  {
    value: "qwen",
    provider: "qwen",
    label: "Qwen",
    description: "Use Qwen models through Alibaba Cloud Model Studio.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "qwen3.6-plus",
    apiKeyPlaceholder: "sk-...",
    helperHref: "https://modelstudio.console.alibabacloud.com/",
    iconSrc: "/logos/providers/qwen.svg",
  },
  {
    value: "mistral",
    provider: "mistral",
    label: "Mistral AI",
    description: "Use Mistral chat and reasoning models directly.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "mistral-large-latest",
    apiKeyPlaceholder: "sk-...",
    helperHref: "https://console.mistral.ai/api-keys/",
    iconSrc: "/logos/providers/mistral-ai.svg",
  },
  {
    value: "groq",
    provider: "groq",
    label: "Groq",
    description: "Use fast hosted open-weight models through GroqCloud.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "openai/gpt-oss-120b",
    apiKeyPlaceholder: "gsk_...",
    helperHref: "https://console.groq.com/keys",
    iconSrc: "/logos/providers/groq.svg",
  },
  {
    value: "togetherai",
    provider: "togetherai",
    label: "Together.ai",
    description: "Use Together.ai serverless open-source model hosting.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
    apiKeyPlaceholder: "tok_...",
    helperHref: "https://api.together.ai/settings/api-keys",
    iconSrc: "/logos/providers/together-ai.svg",
  },
  {
    value: "deepinfra",
    provider: "deepinfra",
    label: "DeepInfra",
    description: "Use DeepInfra's hosted open-source model catalog.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
    apiKeyPlaceholder: "sk-...",
    helperHref: "https://deepinfra.com/dash/api_keys",
    iconSrc: "/logos/providers/deepinfra.svg",
  },
  {
    value: "fireworks",
    provider: "fireworks",
    label: "Fireworks AI",
    description: "Use Fireworks-hosted open-weight and fine-tuned models.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "accounts/fireworks/models/deepseek-v4-flash",
    apiKeyPlaceholder: "fw_...",
    helperHref: "https://app.fireworks.ai/settings/users/api-keys",
    iconSrc: "/logos/providers/fireworks-ai.svg",
  },
  {
    value: "huggingface",
    provider: "huggingface",
    label: "Hugging Face",
    description: "Use Hugging Face Inference Providers and routed models.",
    category: "direct",
    shortLabel: "Direct API",
    capability: "Hosted",
    authLabel: "API key",
    defaultModel: "deepseek-ai/DeepSeek-V4-Flash:deepinfra",
    apiKeyPlaceholder: "hf_...",
    helperHref: "https://huggingface.co/settings/tokens",
    iconSrc: "/logos/providers/huggingface.svg",
  },
  {
    value: "openrouter",
    provider: "openrouter",
    label: "OpenRouter",
    description: "Route across many hosted model families with one account.",
    category: "router",
    shortLabel: "Model router",
    capability: "Multi-provider",
    authLabel: "API key or OAuth",
    defaultModel: OPENROUTER_DEFAULT_MODEL,
    apiKeyPlaceholder: "sk-or-...",
    helperHref: "https://openrouter.ai/settings/keys",
    iconSrc: "/logos/providers/openrouter.svg",
    wordmarkSrc: "/logos/providers/openrouter-wordmark.svg",
  },
  {
    value: "ollama",
    provider: "ollama",
    label: "Ollama",
    description: "Use Ollama's local OpenAI-compatible endpoint.",
    category: "local",
    shortLabel: "Local",
    capability: "Local",
    authLabel: "No key",
    defaultModel: "",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresBaseUrl: true,
    requiresApiKey: false,
    apiKeyPlaceholder: "No key required",
    helperHref: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    iconSrc: "/logos/providers/ollama.svg",
  },
  {
    value: "lmstudio",
    provider: "lmstudio",
    label: "LM Studio",
    description: "Use LM Studio's local OpenAI-compatible server.",
    category: "local",
    shortLabel: "Local",
    capability: "Local",
    authLabel: "No key",
    defaultModel: "",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresBaseUrl: true,
    requiresApiKey: false,
    apiKeyPlaceholder: "No key required",
    helperHref: "https://lmstudio.ai/docs/app/api/endpoints/openai",
    iconSrc: "/logos/providers/lmstudio.svg",
  },
  {
    value: "custom",
    provider: "custom",
    label: "Custom endpoint",
    description: "Use another OpenAI-compatible base URL.",
    category: "custom",
    shortLabel: "OpenAI-compatible",
    capability: "Local or hosted",
    authLabel: "Optional key",
    defaultModel: "",
    requiresBaseUrl: true,
    requiresApiKey: false,
    apiKeyPlaceholder: "Optional for local endpoints",
    helperHref: "https://platform.openai.com/docs/api-reference",
  },
];

const EXPERIMENTAL_PROVIDER_VALUES = new Set<LlmProviderOptionValue>([
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
  "groq",
  "togetherai",
  "deepinfra",
  "fireworks",
  "huggingface",
  "ollama",
  "lmstudio",
  "custom",
]);

const LOCAL_MODEL_PROVIDER_VALUES = new Set<LlmProviderOptionValue>([
  "ollama",
  "lmstudio",
]);

function isExperimentalProvider(value: LlmProviderOptionValue) {
  return EXPERIMENTAL_PROVIDER_VALUES.has(value);
}

function isLocalModelProvider(value: LlmProviderOptionValue) {
  return LOCAL_MODEL_PROVIDER_VALUES.has(value);
}

export function llmProviderOption(value: LlmProviderOptionValue) {
  return (
    LLM_PROVIDER_OPTIONS.find((option) => option.value === value) ??
    LLM_PROVIDER_OPTIONS.find((option) => option.value === "openrouter") ??
    LLM_PROVIDER_OPTIONS[0]
  );
}

export function displayBaseUrl(baseUrl?: string) {
  return baseUrl?.replace("host.docker.internal", "localhost") ?? "";
}

export function localLlmPresetForBaseUrl(baseUrl?: string) {
  const displayUrl = displayBaseUrl(baseUrl);
  if (!displayUrl) return undefined;

  try {
    const parsed = new URL(displayUrl);
    if (parsed.port === "11434") {
      return llmProviderOption("ollama");
    }
    if (parsed.port === "1234") {
      return llmProviderOption("lmstudio");
    }
  } catch {
    if (displayUrl.includes(":11434")) return llmProviderOption("ollama");
    if (displayUrl.includes(":1234")) return llmProviderOption("lmstudio");
  }

  return undefined;
}

export function llmProviderLabelForStatus(status?: ServiceSetupStatus) {
  if (status?.provider === "custom") {
    return localLlmPresetForBaseUrl(status.baseUrl)?.label ?? "Custom endpoint";
  }
  if (status?.provider) return llmProviderOption(status.provider).label;
  return status?.providerLabel;
}

export function LlmProviderLogo({
  provider,
  variant = "wordmark",
  className = "",
}: {
  provider: LlmProviderOptionValue;
  variant?: "icon" | "wordmark";
  className?: string;
}) {
  const option = llmProviderOption(provider);
  const src = option.iconSrc ?? option.wordmarkSrc;

  if (variant === "icon") {
    if (!src) {
      return (
        <Plug
          aria-label={option.label}
          className={`size-7 shrink-0 text-foreground ${className}`}
          strokeWidth={2}
        />
      );
    }

    return (
      <img
        src={src}
        alt={option.label}
        className={`size-7 shrink-0 object-contain dark:invert ${className}`}
      />
    );
  }

  if (!src) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <Plug
          aria-hidden="true"
          className="size-7 shrink-0 text-foreground"
          strokeWidth={2}
        />
        <span className="text-base font-semibold tracking-tight text-foreground">
          {option.label}
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0 object-contain dark:invert"
      />
      <span className="text-base font-semibold tracking-tight text-foreground">
        {option.label}
      </span>
    </span>
  );
}

export function LlmProviderBrand({
  provider,
  baseUrl,
}: {
  provider?: LlmProviderType;
  baseUrl?: string;
}) {
  if (provider) {
    const option =
      provider === "custom"
        ? localLlmPresetForBaseUrl(baseUrl) ?? llmProviderOption("custom")
        : llmProviderOption(provider);

    return (
      <div className="flex items-center gap-2 text-foreground">
        <LlmProviderLogo
          provider={option.value}
          variant="wordmark"
          className="h-8 max-w-44"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-foreground">
      <span className="text-xl font-semibold tracking-tight">Model provider</span>
    </div>
  );
}

export function LlmProviderSelector({
  value,
  onChange,
}: {
  value: LlmProviderOptionValue;
  onChange: (provider: LlmProviderOptionValue) => void;
}) {
  const [showExperimentalProviders, setShowExperimentalProviders] =
    useState(() => isExperimentalProvider(value));
  const experimentalProvidersVisible =
    showExperimentalProviders || isExperimentalProvider(value);
  const orderedOptions = LLM_PROVIDER_GROUPS.flatMap((group) =>
    LLM_PROVIDER_OPTIONS.filter((option) =>
      group.categories.includes(option.category),
    ),
  ).filter(
    (option) =>
      experimentalProvidersVisible || !isExperimentalProvider(option.value),
  );

  function handleExperimentalChange(checked: boolean) {
    setShowExperimentalProviders(checked);
    if (!checked && isExperimentalProvider(value)) {
      onChange("openrouter");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="ml-auto flex w-fit items-center gap-2 text-xs font-medium text-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={experimentalProvidersVisible}
            onChange={(event) => handleExperimentalChange(event.target.checked)}
            className="size-4 rounded border-border bg-background accent-foreground"
          />
          <span>Experimental Providers</span>
        </label>
        <span
          tabIndex={0}
          aria-describedby="experimental-provider-tooltip"
          className="group relative inline-flex outline-none"
        >
          <CircleHelp
            aria-hidden="true"
            className="size-3.5 text-muted"
          />
          <span
            id="experimental-provider-tooltip"
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 border border-border bg-surface px-3 py-2 text-left text-xs leading-5 text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            New providers that have not been tested thoroughly. Use at your own
            risk!
          </span>
        </span>
      </div>
      <div className="max-h-[min(36vh,18rem)] overflow-y-auto border border-border bg-background">
        <div className="divide-y divide-border">
          {orderedOptions.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                data-provider-value={option.value}
                onClick={() => onChange(option.value)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 ${
                  selected
                    ? "bg-foreground/[0.04]"
                    : "bg-background hover:bg-foreground/[0.025]"
                }`}
              >
                <span
                  className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-foreground" : "border-muted/40"
                  }`}
                  aria-hidden="true"
                >
                  {selected && (
                    <span className="size-2 rounded-full bg-foreground" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:grid sm:grid-cols-[240px_1fr] sm:items-center sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <LlmProviderLogo provider={option.value} variant="wordmark" />
                    {isLocalModelProvider(option.value) && (
                      <span
                        tabIndex={0}
                        aria-describedby={`${option.value}-local-model-tooltip`}
                        className="group relative inline-flex shrink-0 outline-none"
                      >
                        <TriangleAlert
                          aria-hidden="true"
                          className="size-4 text-muted"
                        />
                        <span
                          id={`${option.value}-local-model-tooltip`}
                          role="tooltip"
                          className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 w-64 -translate-y-1/2 border border-border bg-surface px-3 py-2 text-left text-xs leading-5 text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        >
                          Small local models are not recommended for BigSet.
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm leading-5 text-foreground/80">
                      {option.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
