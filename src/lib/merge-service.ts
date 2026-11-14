import { after } from "next/server";

import { runMergeJob } from "@/lib/merge";
import {
  ensureSchema,
  getGeneration,
  insertMerge,
} from "@/lib/turso";
import type { MergeJob } from "@/lib/types";

/**
 * خدمة إنشاء وظائف الدمج المشتركة — تستخدمها:
 * POST /api/merge (الواجهة) وأداة merge_videos في MCP.
 * تتحقق من صلاحية المقاطع، تُنشئ صف الوظيفة، وتبدأ البناء خلف الرد (after).
 */

/** أقصى عدد مقاطع في الدمج الواحد */
export const MERGE_MAX_PARTS = 8;

/** خطأ في طلب الدمج (يرد للعميل كـ 400) */
export class MergeRequestError extends Error {}

/** التحقق من المقاطع ثم إنشاء وظيفة الدمج وبدء البناء خلف الرد */
export async function createMergeJob(
  ids: string[],
  origin: string
): Promise<MergeJob> {
  await ensureSchema();

  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  if (unique.length < 2) {
    throw new MergeRequestError("اختر مقطعين مختلفين على الأقل للدمج");
  }
  if (unique.length > MERGE_MAX_PARTS) {
    throw new MergeRequestError(
      `الحد الأقصى ${MERGE_MAX_PARTS} مقاطع في الدمج الواحد`
    );
  }

  for (let i = 0; i < unique.length; i++) {
    const gen = await getGeneration(unique[i]!);
    if (!gen) {
      throw new MergeRequestError(`المقطع رقم ${i + 1} غير موجود في السجل`);
    }
    if (gen.type !== "video") {
      throw new MergeRequestError(
        `العنصر رقم ${i + 1} ليس فيديو — الدمج للفيديوهات فقط`
      );
    }
    if (gen.status !== "success" || gen.resultUrls.length === 0) {
      throw new MergeRequestError(
        `المقطع رقم ${i + 1} غير مكتمل بعد — اكتمال بنجاح شرط للدمج`
      );
    }
  }

  const now = Date.now();
  const job: MergeJob = {
    id: crypto.randomUUID(),
    generationIds: unique,
    status: "processing",
    error: null,
    fileUrl: "",
    createdAt: now,
    updatedAt: now,
  };
  await insertMerge(job);

  after(async () => {
    await runMergeJob(job, origin);
  });

  return job;
}
