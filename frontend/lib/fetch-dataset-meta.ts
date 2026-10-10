export type ColumnType = "text" | "number" | "boolean" | "url" | "date";

export interface DatasetMeta {
  name: string;
  description: string;
  rowCount?: number;
  columns: { name: string; type: ColumnType; description?: string; isPrimaryKey?: boolean }[];
}

export async function fetchPublicDatasetMeta(
  id: string,
  { noCache = false } = {},
): Promise<DatasetMeta | null> {
  const convexUrl =
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    "http://localhost:3210";

  try {
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "datasets:get", args: { id }, format: "json" }),
      signal: AbortSignal.timeout(5000),
      ...(noCache ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success") return null;
    const dataset = json.value;
    if (!dataset || dataset.visibility !== "public") return null;
    return dataset as DatasetMeta;
  } catch {
    return null;
  }
}
