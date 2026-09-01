import { z } from "zod";

export const columnTypeSchema = z.enum([
  "string",
  "url",
  "date",
  "number",
  "boolean",
  "enum",
]);
export type ColumnType = z.infer<typeof columnTypeSchema>;

export const retrievalStrategySchema = z.enum([
  "search_fetch",
  "browser",
  "hybrid",
]);
export type RetrievalStrategy = z.infer<typeof retrievalStrategySchema>;

const snakeCase = /^[a-z][a-z0-9_]*$/;

export const columnDefinitionSchema = z.object({
  name: z.string().regex(snakeCase, "must be snake_case"),
  display_name: z.string().min(1),
  type: columnTypeSchema,
  is_primary_key: z.boolean(),
  is_enumerable: z.boolean(),
  retrieval_hint: z.string(),
  nullable: z.boolean(),
});
export type ColumnDefinition = z.infer<typeof columnDefinitionSchema>;

export const datasetSchemaSchema = z
  .object({
    dataset_name: z.string().regex(snakeCase, "must be snake_case"),
    description: z.string().min(1),
    columns: z.array(columnDefinitionSchema).min(1),
    primary_key: z.union([z.string(), z.array(z.string())]),
    retrieval_strategy: retrievalStrategySchema,
    source_hint: z.string().min(1),
    suggested_row_count: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    const names = data.columns.map((c) => c.name);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate column names: ${dupes.join(", ")}`,
        path: ["columns"],
      });
    }

    const pkCols = data.columns.filter((c) => c.is_primary_key);
    if (pkCols.length < 1) {
      ctx.addIssue({
        code: "custom",
        message: `at least one column must have is_primary_key=true (found 0)`,
        path: ["columns"],
      });
      return;
    }

    const pkNames = pkCols.map((c) => c.name);
    const declaredPkRaw = Array.isArray(data.primary_key)
      ? data.primary_key
      : [data.primary_key];
    const declaredPk = [...new Set(declaredPkRaw)];
    if (
      declaredPk.length !== declaredPkRaw.length ||
      declaredPk.length !== pkNames.length ||
      !declaredPk.every((n) => pkNames.includes(n))
    ) {
      ctx.addIssue({
        code: "custom",
        message: `primary_key ${JSON.stringify(declaredPk)} does not match columns flagged is_primary_key (${JSON.stringify(pkNames)})`,
        path: ["primary_key"],
      });
    }
    for (const pk of pkCols) {
      if (pk.nullable) {
        ctx.addIssue({
          code: "custom",
          message: `primary key column '${pk.name}' must not be nullable`,
          path: ["columns"],
        });
      }
      if (!pk.is_enumerable) {
        ctx.addIssue({
          code: "custom",
          message: `primary key column '${pk.name}' must have is_enumerable=true`,
          path: ["columns"],
        });
      }
    }
  });
export type DatasetSchema = z.infer<typeof datasetSchemaSchema>;

export const datasetRowValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type DatasetRowValue = z.infer<typeof datasetRowValueSchema>;

export const datasetRowSchema = z.record(z.string(), datasetRowValueSchema);
export type DatasetRow = z.infer<typeof datasetRowSchema>;

export const endpointCallSchema = z.object({
  endpoint: z.enum(["search", "fetch", "browser"]),
  count: z.number().int().nonnegative(),
});
export type EndpointCall = z.infer<typeof endpointCallSchema>;

export const runManifestSchema = z.object({
  run_id: z.string(),
  prompt: z.string(),
  schema_path: z.string(),
  dataset_path: z.string(),
  csv_path: z.string(),
  row_count: z.number().int().nonnegative(),
  columns_filled: z.array(z.string()),
  created_at: z.string(),
  endpoints_called: z.array(endpointCallSchema),
});
export type RunManifest = z.infer<typeof runManifestSchema>;
