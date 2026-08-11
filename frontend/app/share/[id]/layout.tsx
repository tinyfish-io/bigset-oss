import type { Metadata } from "next";
import { fetchPublicDatasetMeta } from "@/lib/fetch-dataset-meta";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dataset = await fetchPublicDatasetMeta(id);

  if (!dataset) return { title: "BigSet" };

  const description = [
    dataset.description,
    dataset.columns.length ? `${dataset.columns.length} columns` : null,
    dataset.rowCount != null ? `${dataset.rowCount} rows` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${dataset.name} | BigSet`,
    description,
    openGraph: { title: dataset.name, description, type: "website", siteName: "BigSet" },
    twitter: { card: "summary", title: dataset.name, description },
  };
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
