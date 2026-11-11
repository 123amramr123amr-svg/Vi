import { NextResponse } from "next/server";
import { ensureSchema, listPublished } from "@/lib/turso";

export const dynamic = "force-dynamic";

/** GET /api/published — الأعمال المنشورة في المعرض العام (للزوار ولـ ChatGPT) */
export async function GET() {
  await ensureSchema();
  const items = await listPublished(60);
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
