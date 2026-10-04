import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { searchWebTool, fetchPageTool } from "../tools/web-tools.js";
import type { AuthContext } from "../workflows/populate.js";

export interface EnrichColumn {
  name: string;
  type: "text" | "number" | "boolean" | "url" | "date";
  description?: string;
}

function buildEnrichInstructions(
  sourceData: Record<string, unknown>,
  targetColumns: EnrichColumn[],
): string {
  const sources = Object.entries(sourceData)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const targets = targetColumns
    .map((c) => `- "${c.name}" (${c.type})${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  return `You research one entity and fill in missing fields. Be fast — you have very few steps.

KNOWN INFORMATION (use this to identify the entity):
${sources}

FIELDS TO FIND (research these):
${targets}

RULES:
- Do NOT fetch the same URL twice.
- You have at most 6 tool calls total. Budget them: 1 search + 1-2 fetches = done.
- ALWAYS return a value for every field, even if partial. Use "" for unknown text fields, 0 for unknown numbers.
- Never fabricate values. Use "" or 0 for anything you cannot verify.
- Return ONLY a JSON object — no extra text, no markdown, no explanation.

TOOL CALL FORMAT:
  search_web: {"query": "your search terms"}
  fetch_page: {"url": "https://example.com/page"}

WORKFLOW:
1. Search the web for this entity using the known information.
2. Fetch 1-2 of the best results.
3. Extract the missing field values from fetched content.
4. Return JSON with ONLY the target fields as keys.

EXAMPLE RESPONSE:
${JSON.stringify(Object.fromEntries(targetColumns.map((c) => [c.name, "value"])))}

Return your JSON response now.`;
}

export function buildEnrichAgent(
  _authorizedDatasetId: string,
  authContext: AuthContext,
  sourceData: Record<string, unknown>,
  targetColumns: EnrichColumn[],
  openRouterApiKey: string,
): Agent {
  if (!authContext.modelConfig?.investigateSubagent) {
    throw new Error("modelConfig.investigateSubagent is not configured");
  }
  const modelSlug = authContext.modelConfig.investigateSubagent;
  const openrouter = createOpenRouter({
    apiKey: openRouterApiKey,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });

  return new Agent({
    id: "enrich-agent",
    name: "Data Enrichment Agent",
    instructions: buildEnrichInstructions(sourceData, targetColumns),
    model: openrouter(modelSlug),
    tools: {
      search_web: searchWebTool,
      fetch_page: fetchPageTool,
    },
  });
}

export function parseEnrichResponse(
  text: string,
  targetColumns: string[],
): Record<string, unknown> | null {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    const match = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (match) jsonStr = match[1];
  }
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!braceMatch) return null;
  try {
    const parsed = JSON.parse(braceMatch[0]);
    const result: Record<string, unknown> = {};
    for (const col of targetColumns) {
      if (col in parsed && parsed[col] !== null && parsed[col] !== "") {
        result[col] = parsed[col];
      }
    }
    return result;
  } catch {
    return null;
  }
}