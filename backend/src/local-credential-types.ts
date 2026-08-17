export const LOCAL_CREDENTIAL_SERVICES = [
  "tinyfish",
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

export type LocalCredentialService = (typeof LOCAL_CREDENTIAL_SERVICES)[number];
export type ConnectionMethod = "api_key" | "oauth";

export function isLocalCredentialService(
  value: unknown,
): value is LocalCredentialService {
  return (
    typeof value === "string" &&
    (LOCAL_CREDENTIAL_SERVICES as readonly string[]).includes(value)
  );
}

export function localKeychainAccount(
  workspaceId: string,
  service: LocalCredentialService,
): string {
  return `${workspaceId}:${service}`;
}
