import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildSubagentTool } from "../tools/investigate-tool.js";
import { buildWebTools } from "../tools/web-tools.js";
import type { AuthContext } from "../workflows/populate.js";
import type { PopulateColumn } from "../../pipeline/populate.js";
import type { RunMetrics } from "../run-metrics.js";

function buildInstructions(maxRowCount: number): string {
  return `You are an expert dataset builder. You conduct research using your web tools.
You do broad research to see which rows to add, and then you spin up sub-agents that can do the deep research and fill in each row for you.
Your job is to make sure you dispatch and manage your army of sub agents to build up a dataset with ${maxRowCount} rows in it. Stop as soon as the dataset reaches ${maxRowCount} rows.

WORKFLOW:
1. Understand the data that is is needed and do some research to find places on the web where this data may be obvious and easy to find, collect these links to see what the task of scraping the web is going to look like.
If the dataset is to look at YC Companies, collect links for the YC Startup registry and so on.

2. Trigger sub agents. Start doing broad research and identify basic information of the rows in the dataset. Let's say you find a company named "Boody", trigger the run_subagent tool with all the necesarry context (links and places to look) so that it can go and effectivly fill in the data.

3. See what the subagent reports back with, if all good and it gives you some information, use that to give better instuctions to subsequent sub agents.

Keep going until you have ${maxRowCount} rows, then finish immediately. If run_subagent reports ROW_LIMIT_REACHED, stop calling tools and finish the run.

This process should become faster overtime as you just find new rows to go and build, and you keep invoking sub agents in parallel to fill them in.

Duplicates are rejected automatically based on primary key columns. If a subagent reports a duplicate, don't re-investigate the same entity — move on to a new one.
`;
}

/**
 * Build the orchestrator Agent for a populate run.
 *
 * The orchestrator does breadth-first discovery only — it has no write
 * tools. All row insertions go through run_subagent, which spawns a
 * fresh subagent scoped to the same authorized dataset via closure.
 *
 * A fresh orchestrator is constructed per workflow run; do not cache.
 */
export function buildPopulateAgent(
  authorizedDatasetId: string,
  authContext: AuthContext,
  columns: PopulateColumn[],
  openRouterApiKey: string,
  maxRowCount: number,
  metrics?: RunMetrics,
): Agent {
  const modelSlug = authContext.modelConfig!.populateOrchestrator;
  const openrouter = createOpenRouter({
    apiKey: openRouterApiKey,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });
  const { searchWebTool, fetchPageTool } = buildWebTools(authorizedDatasetId);

  return new Agent({
    id: "populate-agent",
    name: "Dataset Populate Orchestrator",
    instructions: buildInstructions(maxRowCount),
    model: openrouter(modelSlug),
    tools: {
      search_web: searchWebTool,
      fetch_page: fetchPageTool,
      run_subagent: buildSubagentTool(
        authorizedDatasetId,
        authContext,
        columns,
        openRouterApiKey,
        maxRowCount,
        metrics,
      ),
    },
  });
}
