import { NextResponse } from "next/server";
import { ensureSchema, listGenerations } from "@/lib/turso";

export const dynamic = "force-dynamic";

/** GET /api/generations — آخر الأعمال المولّدة من قاعدة البيانات */
export async function GET() {
  await ensureSchema();
  const items = await listGenerations(60);
  return NextResponse.json({ items });
}
