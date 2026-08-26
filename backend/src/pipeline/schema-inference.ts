import { generateText, Output, NoObjectGeneratedError } from "ai";

import { DEFAULT_MODEL_IDS } from "../config/models.js";
import { createLanguageModel, type ReasoningLevel } from "../config/llm.js";
import { requireLlmProviderConfig } from "../local-credentials.js";
import { datasetSchemaSchema, type DatasetSchema } from "./types.js";

const SYSTEM_PROMPT = `You are a data engineering assistant that converts natural-language prompts into structured dataset schemas. Given a user prompt describing a dataset they want to build, you produce a precise schema definition.

Your job is to:

1. Identify the universe of entities the user wants to collect. Each entity becomes one row in the dataset.
2. Pick primary key column(s) — one or more columns whose combined values uniquely identify each row (no two legitimate rows should share the same values across all primary key columns in any case). Refrain from names unless necessary, as they may not always be unique (unless this is guaranteed). Otherwise use things like URLs or IDs that are guaranteed to be unique. Set \`is_primary_key: true\` on each primary key column. Set \`primary_key\` to an array of primary key column names; use a one-item array for a single primary key. Every primary key column must have \`nullable: false\` and \`is_enumerable: true\`. Prefer a single column when one naturally uniquely identifies each row.
3. Choose useful columns. Each column captures one fact about the entity. Use snake_case names. Mark \`is_enumerable: true\` only on columns whose values can be used to list all rows (typically just the primary key, and occasionally one or two others when a source page lists them alongside the primary key).
4. Set \`retrieval_strategy\`:
   - \`search_fetch\` — the data lives on a static page or sitemap that can be fetched as HTML.
   - \`browser\` — the source is a JavaScript-heavy SPA, requires scroll/click to reveal items, or paginates client-side.
   - \`hybrid\` — unclear; the pipeline will try search_fetch first and fall back to browser.
5. Set \`source_hint\` to a specific URL whenever possible (e.g. \`https://www.ycombinator.com/companies?industry=Fintech\`). Avoid vague descriptions.
6. Write a \`retrieval_hint\` for each column describing where/how the value can be found later. Downstream agents will use this to fill the column for each row.

Rules:

- Keep it simple. Include only 4-6 columns — the essentials someone would put in a quick spreadsheet for this topic. Do not add niche, speculative, or hard-to-find columns.
- \`dataset_name\` must be snake_case.
- All column \`name\` values must be snake_case and unique.
- Prefer concrete column choices over speculative ones — better to omit a column than guess wildly.
- When a column is a scalar numeric rating (e.g. average score like 4.3/5 for restaurants, cafes, hotels, products, apps): name it generically (e.g. "rating" not "yelp_rating") and write a retrieval_hint explaining that review sites (Yelp, TripAdvisor, Google Maps) block direct page fetches, so the agent must extract ratings from **search result snippets**. The hint should say: "Search for \\"<entity name> rating reviews\\" and include location terms only when location is part of the entity identity. Look for ratings in snippets from TripAdvisor (\\"rated X.X of 5\\"), Yelp search listings (\\"X.X (N reviews)\\"), or aggregator sites (Birdeye, joe.coffee, giftly, Uber Eats, menufyy). Do NOT try to fetch yelp.com or tripadvisor.com directly — they block automated access. Accept ratings from any reputable source." If including a rating column, also add a "rating_source" text column so the agent records where the rating came from. Do not rename review-count or review-text fields to "rating" — keep those as distinct columns (e.g. "review_count") when the user explicitly asks for them.`;

async function getModel(modelSlug?: string, reasoning?: ReasoningLevel) {
  const config = await requireLlmProviderConfig();
  const resolvedSlug = modelSlug ?? config.defaultModel ?? DEFAULT_MODEL_IDS.SCHEMA_INFERENCE;
  return createLanguageModel(config, resolvedSlug, reasoning);
}

export async function inferSchema(
  prompt: string,
  modelSlug?: string,
  reasoning?: ReasoningLevel,
): Promise<DatasetSchema> {
  const model = await getModel(modelSlug, reasoning);
  try {
    return await callOnce(model, prompt);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const detail = error.cause ? String(error.cause) : error.text;
      const retry = `${prompt}\n\nYour previous output failed validation:\n${detail}\n\nReturn a corrected DatasetSchema.`;
      return await callOnce(model, retry);
    }
    throw error;
  }
}

async function callOnce(
  model: Parameters<typeof generateText>[0]["model"],
  prompt: string,
): Promise<DatasetSchema> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: datasetSchemaSchema }),
    system: SYSTEM_PROMPT,
    maxOutputTokens: 4096,
    prompt,
  });
  if (!output) throw new Error("Model did not generate a valid schema object");
  return output;
}
