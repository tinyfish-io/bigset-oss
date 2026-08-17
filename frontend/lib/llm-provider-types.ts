export const LLM_PROVIDER_TYPES = [
  "openrouter",
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
] as const;

export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number];

export const LOCAL_CREDENTIAL_SERVICES = [
  "tinyfish",
  "llm",
  ...LLM_PROVIDER_TYPES,
] as const;

export const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-sonnet-5";
