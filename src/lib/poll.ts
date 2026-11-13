import { getRemoteTaskState, type ProviderSnapshot } from "@/lib/provider";
import { getProviderSettings } from "@/lib/settings";
import { updateGeneration } from "@/lib/turso";
import {
  isActiveStatus,
  type Generation,
  type GenerationStatus,
} from "@/lib/types";

/**
 * متابعة حالة المهام لدى المزوّد المُختار في الإعدادات (أي رابط لأي مفتاح) وتحديث قاعدة البيانات —
 * مشتركة بين GET /api/generations/[id] وأدوات MCP والأوتوبايلوت.
 * تُستعلم كل مهمة عن المزوّد الذي أُنشئت به (لقطة محفوظة في params.provider)،
 * والمهام القديمة (قبل اللقطات) تُستعلم عبر مرشّحات واجهة المهام للرابط الحالي.
 */

/**
 * استعلام واحد عن حالة المهمة لدى المزوّد مع تحديث قاعدة البيانات.
 * يعيد الصف بعد التحديث (أو كما هو إذا فشل الاستعلام العابر).
 */
export async function pollOnce(id: string, row: Generation): Promise<Generation> {
  if (!row.taskId || !isActiveStatus(row.status)) return row;
  try {
    const settings = await getProviderSettings();
    const snapshot: ProviderSnapshot | null = row.params.provider ?? null;
    const task = await getRemoteTaskState(
      row.taskId,
      snapshot,
      { baseUrl: settings.baseUrl, apiKey: settings.apiKey },
      id
    );
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
 * استعلام دوري حتى حالة نهائية (success/fail) أو انتهاء مدة الانتظار.
 * waitSeconds تُقيد بـ 60 ثانية كحد أقصى (حد مدة الدالة على Vercel).
 */
export async function waitForGeneration(options: {
  row: Generation;
  waitSeconds: number;
  intervalMs?: number;
}): Promise<Generation> {
  let row = options.row;
  const waitSeconds = Math.min(Math.max(options.waitSeconds, 0), 60);
  const deadline = Date.now() + waitSeconds * 1000;
  const intervalMs = options.intervalMs ?? 2500;

  while (row.taskId && isActiveStatus(row.status)) {
    row = await pollOnce(row.id, row);
    if (!isActiveStatus(row.status) || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return row;
}
