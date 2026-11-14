/**
 * One place that turns a model slug into an AI SDK model.
 *
 *   claude-code/<model>  → the user's Claude subscription via the Claude Code CLI
 *   codex/<model>        → the user's ChatGPT subscription via the Codex CLI
 *   anything else        → OpenRouter (e.g. anthropic/claude-sonnet-4.6)
 *
 * Subscription CLIs run the tool loop themselves, so for them the tools are
 * bridged into the CLI and the Mastra Agent gets no tools of its own. For
 * OpenRouter the Mastra Agent runs the tools as before.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  LanguageModelV3 as LanguageModel,
  LanguageModelV3FinishReason,
  LanguageModelV3Middleware,
} from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { requireOpenRouterApiKey } from "../local-credentials.js";
import {
  BIGSET_MCP_SERVER,
  subscriptionBackendOf,
  subscriptionLanguageModel,
  type BridgeableTools,
} from "./subscriptions.js";

export function usesOpenRouter(slug: string): boolean {
  return subscriptionBackendOf(slug) === null;
}

/**
 * Resolve the OpenRouter key only when one of the slugs needs it, so a
 * subscription-only setup never asks for a key it does not have.
 */
export async function openRouterKeyFor(
  ...slugs: Array<string | undefined>
): Promise<string | null> {
  if (!slugs.some((slug) => slug && usesOpenRouter(slug))) return null;
  return await requireOpenRouterApiKey();
}

export interface AgentModel<T extends BridgeableTools> {
  model: LanguageModel;
  /** Tools to give the Mastra Agent: all of them for OpenRouter, none for a CLI. */
  agentTools: T | Record<string, never>;
}

export function agentModel<T extends BridgeableTools>(
  slug: string,
  {
    openRouterApiKey,
    tools,
    maxSteps,
  }: { openRouterApiKey: string | null; tools: T; maxSteps?: number },
): AgentModel<T> {
  if (!usesOpenRouter(slug)) {
    return { model: subscriptionLanguageModel(slug, { tools, maxSteps }), agentTools: {} };
  }
  return { model: openRouterModel(slug, openRouterApiKey), agentTools: tools };
}

/** A model for single-shot calls without tools (schema inference, classification). */
export function textModel(slug: string, openRouterApiKey: string | null): LanguageModel {
  if (!usesOpenRouter(slug)) {
    return wrapLanguageModel({
      model: subscriptionLanguageModel(slug),
      middleware: providerToolsAreFinal,
    }) as LanguageModel;
  }
  return openRouterModel(slug, openRouterApiKey);
}

/**
 * Subscription CLIs fill structured output through their own internal tool,
 * so they finish with reason "tool-calls". With no client tools in the call,
 * the AI SDK then refuses to read the output (NoOutputGeneratedError) even
 * though the JSON is there. Nothing is left for the caller to run, so the
 * call has in fact stopped.
 */
function finalReason(reason: LanguageModelV3FinishReason): LanguageModelV3FinishReason {
  return reason.unified === "tool-calls" ? { ...reason, unified: "stop" } : reason;
}

const providerToolsAreFinal: LanguageModelV3Middleware = {
  specificationVersion: "v3",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    return { ...result, finishReason: finalReason(result.finishReason) };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            controller.enqueue(
              part.type === "finish" ? { ...part, finishReason: finalReason(part.finishReason) } : part,
            );
          },
        }),
      ),
    };
  },
};

function openRouterModel(slug: string, apiKey: string | null): LanguageModel {
  if (!apiKey) {
    throw new Error(
      `Model "${slug}" runs on OpenRouter, but OpenRouter is not configured. Add an OpenRouter key or pick a claude-code/ or codex/ model.`,
    );
  }
  return createOpenRouter({ apiKey, baseURL: process.env.OPENROUTER_BASE_URL })(slug);
}

/**
 * Tool names as BigSet knows them. Subscription CLIs report bridged tools as
 * mcp__bigset__<name> (Claude Code) or <server>.<name> style names (Codex).
 */
export function baseToolName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const claudePrefix = `mcp__${BIGSET_MCP_SERVER}__`;
  if (name.startsWith(claudePrefix)) return name.slice(claudePrefix.length);
  const codexPrefix = `${BIGSET_MCP_SERVER}.`;
  if (name.startsWith(codexPrefix)) return name.slice(codexPrefix.length);
  return name;
}
