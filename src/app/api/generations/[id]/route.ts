import { NextRequest, NextResponse } from "next/server";
import { waitForGeneration } from "@/lib/poll";
import { absolutizeUrls, requestOrigin } from "@/lib/http";
import { deleteGeneration, ensureSchema, getGeneration } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** أقصى مدة انتظار يسمح بها الخادم في الطلب الواحد (ثوانٍ) */
const MAX_WAIT_SECONDS = 8;

/**
 * GET /api/generations/[id] — جلب عنصر واحد.
 * إذا كانت المهمة قيد التنفيذ يتم الاستعلام عن حالتها لدى kie.ai
 * وتحديث قاعدة البيانات قبل إرجاع النتيجة.
 *
 * ?wait=N (حتى 8 ثوانٍ): يبقى الخادم يستعلم دوريًا قبل الرد —
 * مفيد لـ ChatGPT Actions لأنه يقلل عدد الاستدعاءات المطلوبة.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  const waitRaw = Number(req.nextUrl.searchParams.get("wait") ?? "0");
  const waitSeconds = Number.isFinite(waitRaw)
    ? Math.min(Math.max(Math.floor(waitRaw), 0), MAX_WAIT_SECONDS)
    : 0;

  const row = await getGeneration(id);
  if (!row) {
    return NextResponse.json({ error: "العنصر غير موجود" }, { status: 404 });
  }

  const item = await waitForGeneration({ row, waitSeconds });

  /* الروابط الداخلية (بروكسي الوسائط) تُحول لمطلقة لصلاحيتها للعملاء الخارجيين */
  const itemOut = {
    ...item,
    resultUrls: absolutizeUrls(item.resultUrls, requestOrigin(req)),
  };

  return NextResponse.json({ item: itemOut });
}

/** DELETE /api/generations/[id] — حذف عنصر من السجل */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  await deleteGeneration(id);
  return NextResponse.json({ ok: true });
}
