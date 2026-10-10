import { NextResponse } from "next/server";

const CORS = { "Access-Control-Allow-Origin": "*" };
const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:3501";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/share/${id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, { headers: CORS });
    }
    if (res.status === 404) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404, headers: CORS });
    }
    return NextResponse.json({ error: "Upstream service error" }, { status: 502, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Upstream service error" }, { status: 502, headers: CORS });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
