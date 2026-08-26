import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

loadDotenv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  PROD: process.env.PROD,
  IS_PROD: process.env.PROD === "1",
  IS_LOCAL_MODE: process.env.PROD !== "1",
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:3500",
  CONVEX_URL: required("CONVEX_URL"),
  PORT: numberFromEnv("PORT", 3501),

  // Used by ./convex.ts to call internal Convex functions (e.g. agent-driven
  // row inserts). Optional today because no scheduled jobs run yet; required
  // once the agent runner actually writes to Convex.
  CONVEX_ADMIN_KEY: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,

  // Used by ./clerk-auth.ts to verify JWTs on protected routes (e.g.
  // /infer-schema). Required for the backend to function.
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY:
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,

  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  GOOGLE_GENERATIVE_AI_BASE_URL: process.env.GOOGLE_GENERATIVE_AI_BASE_URL,
  XAI_BASE_URL: process.env.XAI_BASE_URL,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  QWEN_BASE_URL: process.env.QWEN_BASE_URL,
  MISTRAL_BASE_URL: process.env.MISTRAL_BASE_URL,
  GROQ_BASE_URL: process.env.GROQ_BASE_URL,
  TOGETHER_BASE_URL: process.env.TOGETHER_BASE_URL,
  DEEPINFRA_BASE_URL: process.env.DEEPINFRA_BASE_URL,
  FIREWORKS_BASE_URL: process.env.FIREWORKS_BASE_URL,
  HUGGINGFACE_BASE_URL: process.env.HUGGINGFACE_BASE_URL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL,
  BIGSET_LOCAL_WORKSPACE_ID: required("BIGSET_LOCAL_WORKSPACE_ID"),
  LOCAL_KEYCHAIN_URL: process.env.LOCAL_KEYCHAIN_URL,
  LOCAL_KEYCHAIN_TOKEN: process.env.LOCAL_KEYCHAIN_TOKEN,
  LOCAL_KEYCHAIN_TIMEOUT_MS: numberFromEnv("LOCAL_KEYCHAIN_TIMEOUT_MS", 5_000),

  // Default models — used when a user has not saved a preference.
  // In production these are still interpreted as OpenRouter model slugs; in
  // local mode the selected LLM provider's default model is used first.
  SCHEMA_INFERENCE_MODEL:
    process.env.SCHEMA_INFERENCE_MODEL ?? "anthropic/claude-opus-5",
  POPULATE_ORCHESTRATOR_MODEL:
    process.env.POPULATE_ORCHESTRATOR_MODEL ?? "anthropic/claude-sonnet-5",
  INVESTIGATE_SUBAGENT_MODEL:
    process.env.INVESTIGATE_SUBAGENT_MODEL ?? "openai/gpt-5.6-luna",

  // Resend (transactional email). Optional — when RESEND_API_KEY is unset
  // the email module no-ops with a log line, so local dev works without
  // a Resend account. EMAIL_FROM must be a domain that's verified in the
  // Resend dashboard.
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM || "BigSet <simantak@tinyfish.ai>",

  // PostHog (server-side analytics for events the frontend can't observe —
  // currently just the transactional email lifecycle). Same project key
  // as the frontend (`phc_...`); events identify by Clerk userId so they
  // associate to the same user the frontend already identified.
  // No-op when unset.
  POSTHOG_KEY: process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY,
  POSTHOG_HOST:
    process.env.POSTHOG_HOST ||
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    "https://us.i.posthog.com",

  REFRESH_SCHEDULER_ENABLED:
    process.env.REFRESH_SCHEDULER_ENABLED !== "false",
  REFRESH_SCHEDULER_POLL_MS: numberFromEnv(
    "REFRESH_SCHEDULER_POLL_MS",
    60_000,
  ),
  REFRESH_SCHEDULER_BATCH_SIZE: numberFromEnv(
    "REFRESH_SCHEDULER_BATCH_SIZE",
    5,
  ),
  REFRESH_SCHEDULER_STALE_AFTER_MS: numberFromEnv(
    "REFRESH_SCHEDULER_STALE_AFTER_MS",
    6 * 60 * 60 * 1000,
  ),

};
