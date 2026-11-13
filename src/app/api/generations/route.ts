import { NextRequest, NextResponse } from "next/server";
import { absolutizeUrls, requestOrigin } from "@/lib/http";
import { ensureSchema, listGenerations } from "@/lib/turso";

export const dynamic = "force-dynamic";

/** GET /api/generations — آخر الأعمال المولّدة من قاعدة البيانات */
export async function GET(req: NextRequest) {
  await ensureSchema();
  const items = await listGenerations(60);
  /* الروابط الداخلية (بروكسي الوسائط) تُحول لمطلقة */
  const origin = requestOrigin(req);
  return NextResponse.json({
    items: items.map((it) => ({
      ...it,
      resultUrls: absolutizeUrls(it.resultUrls, origin),
    })),
  });
}
