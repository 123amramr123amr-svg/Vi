import { NextRequest, NextResponse } from "next/server";
import { getKieTask } from "@/lib/kie";
import {
  deleteGeneration,
  ensureSchema,
  getGeneration,
  updateGeneration,
} from "@/lib/turso";
import {
  isActiveStatus,
  type Generation,
  type GenerationStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** أقصى مدة انتظار يسمح بها الخادم في الطلب الواحد (ثوانٍ) */
const MAX_WAIT_SECONDS = 8;
const POLL_INTERVAL_MS = 2500;

/**
 * استعلام واحد عن حالة المهمة لدى kie.ai مع تحديث قاعدة البيانات.
 * يعيد الصف بعد التحديث (أو كما هو إذا فشل الاستعلام العابر).
 */
async function pollOnce(id: string, row: Generation): Promise<Generation> {
  if (!row.taskId || !isActiveStatus(row.status)) return row;
  try {
    const task = await getKieTask(row.taskId);
    if (task.state === "success") {
      await updateGeneration(id, {
        status: "success",
        resultUrls: task.resultUrls,
      });
      return {
        ...row,
        status: "success",
        resultUrls: task.resultUrls,
        updatedAt: Date.now(),
      };
    } else if (task.state === "fail") {
      const message = task.failMsg ?? "فشل التوليد";
      await updateGeneration(id, { status: "fail", error: message });
      return { ...row, status: "fail", error: message, updatedAt: Date.now() };
    } else if (task.state !== row.status) {
      await updateGeneration(id, { status: task.state as GenerationStatus });
      return {
        ...row,
        status: task.state as GenerationStatus,
        updatedAt: Date.now(),
      };
    }
  } catch (err) {
    // أخطاء الاستعلام عابرة (شبكة/مزوّد) — نُبقي الحالة الحالية
    console.error("[vi] poll task failed:", err);
  }
  return row;
}

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
  const deadline = Date.now() + waitSeconds * 1000;

  let row = await getGeneration(id);
  if (!row) {
    return NextResponse.json({ error: "العنصر غير موجود" }, { status: 404 });
  }

  while (row.taskId && isActiveStatus(row.status)) {
    row = await pollOnce(id, row);
    // إذا انتهت المهمة أو انتهت مدة الانتظار نرد فورًا
    if (!isActiveStatus(row.status) || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return NextResponse.json({ item: row });
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
