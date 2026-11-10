import { NextRequest, NextResponse } from "next/server";
import { getKieTask } from "@/lib/kie";
import {
  deleteGeneration,
  ensureSchema,
  getGeneration,
  updateGeneration,
} from "@/lib/turso";
import { isActiveStatus, type GenerationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/generations/[id] — جلب عنصر واحد.
 * إذا كانت المهمة قيد التنفيذ يتم الاستعلام عن حالتها لدى kie.ai
 * وتحديث قاعدة البيانات قبل إرجاع النتيجة.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  let row = await getGeneration(id);
  if (!row) {
    return NextResponse.json({ error: "العنصر غير موجود" }, { status: 404 });
  }

  if (row.taskId && isActiveStatus(row.status)) {
    try {
      const task = await getKieTask(row.taskId);
      if (task.state === "success") {
        await updateGeneration(id, {
          status: "success",
          resultUrls: task.resultUrls,
        });
        row = {
          ...row,
          status: "success",
          resultUrls: task.resultUrls,
          updatedAt: Date.now(),
        };
      } else if (task.state === "fail") {
        const message = task.failMsg ?? "فشل التوليد";
        await updateGeneration(id, { status: "fail", error: message });
        row = { ...row, status: "fail", error: message, updatedAt: Date.now() };
      } else if (task.state !== row.status) {
        await updateGeneration(id, { status: task.state as GenerationStatus });
        row = {
          ...row,
          status: task.state as GenerationStatus,
          updatedAt: Date.now(),
        };
      }
    } catch (err) {
      // أخطاء الاستعلام عابرة (شبكة/مزوّد) — نُبقي الحالة الحالية
      console.error("[vi] poll task failed:", err);
    }
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
