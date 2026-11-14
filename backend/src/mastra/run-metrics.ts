/**
 * Per-run metrics collector for the populate and update workflows.
 *
 * A single RunMetrics instance is created at the start of each workflow run,
 * passed by reference into every tool factory and agent builder, and read
 * once at the end to write the runStats Convex record.
 *
 * All operations are synchronous integer increments or field reads — zero
 * I/O, zero meaningful overhead on the hot path.
 *
 * Tier mapping:
 *   populate workflow  → orchestrator = populate agent, investigate = investigate subagents
 *   update workflow    → orchestrator = (unused, stays 0),  investigate = refresh agents
 */

import { baseToolName } from "../ai/language-model.js";

interface AgentResult {
  // Mastra FullOutput: totalUsage sums across all steps; usage is last-step only.
  // Prefer totalUsage for accurate multi-step accounting.
  totalUsage?: { inputTokens?: number; outputTokens?: number };
  usage?: { inputTokens?: number; outputTokens?: number };
  steps?: unknown[];
}

function tokens(result: AgentResult): { input: number; output: number } {
  const src = result.totalUsage ?? result.usage;
  return {
    input: src?.inputTokens ?? 0,
    output: src?.outputTokens ?? 0,
  };
}

export class RunMetrics {
  searchCalls = 0;
  fetchCalls = 0;
  /** run_subagent tool calls dispatched by the orchestrator (populate only). */
  investigateCalls = 0;
  /** Rows successfully inserted across all investigate subagents (populate only). */
  rowsInserted = 0;
  /** Rows successfully updated by refresh agents (update workflow only). */
  rowsUpdated = 0;

  readonly orchestrator = { inputTokens: 0, outputTokens: 0, steps: 0 };
  /**
   * Accumulates tokens for investigate subagents (populate) or refresh agents
   * (update workflow). The `runs` field equals the number of subagent invocations
   * in either workflow.
   */
  readonly investigate = {
    inputTokens: 0,
    outputTokens: 0,
    steps: 0,
    runs: 0,
  };

  addOrchestratorResult(result: AgentResult): void {
    const { input, output } = tokens(result);
    this.orchestrator.inputTokens += input;
    this.orchestrator.outputTokens += output;
    this.orchestrator.steps += result.steps?.length ?? 0;
  }

  addInvestigateResult(result: AgentResult): void {
    const { input, output } = tokens(result);
    this.investigate.inputTokens += input;
    this.investigate.outputTokens += output;
    this.investigate.steps += result.steps?.length ?? 0;
    this.investigate.runs += 1;
  }

  /**
   * Accumulate tokens for one refresh agent run (update workflow).
   * Stored in the `investigate` tier so the runStats schema needs no new columns.
   */
  addRefreshResult(result: AgentResult): void {
    this.addInvestigateResult(result);
  }

  /**
   * Tally tool calls from a flat result.toolCalls array into searchCalls /
   * fetchCalls. Centralised here so callers don't duplicate the loop and
   * tool-name strings.
   */
  countToolCalls(toolCalls: unknown[]): void {
    for (const tc of toolCalls as any[]) {
      // Subscription CLIs report bridged tools as mcp__bigset__search_web etc.
      const name = baseToolName(tc.payload?.toolName ?? tc.toolName);
      if (name === "search_web") this.searchCalls++;
      else if (name === "fetch_page") this.fetchCalls++;
    }
  }

  totals(): { inputTokens: number; outputTokens: number } {
    return {
      inputTokens: this.orchestrator.inputTokens + this.investigate.inputTokens,
      outputTokens:
        this.orchestrator.outputTokens + this.investigate.outputTokens,
    };
  }
}
