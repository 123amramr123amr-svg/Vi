import { buildAutopilotPlan } from "@/lib/autopilot";
import { pollOnce } from "@/lib/poll";
import { startGeneration } from "@/lib/tasks";
import {
  countAutopilot,
  ensureSchema,
  listActiveAutopilot,
  updateGeneration,
} from "@/lib/turso";
import { isActiveStatus, type Generation } from "@/lib/types";

/**
 * خطوة الأوتوبايلوت (منطق مشترك) — تستخدمها:
 * GET/POST /api/autopilot/run (Vercel Cron + زر الواجهة + ChatGPT Action)
 * وأداة run_autopilot في خادم MCP.
 */

export interface AutopilotRunOptions {
  type?: "image" | "video";
  prompt?: string;
  /** false = مسح ونشر فقط دون إنشاء مهمة جديدة */
  create?: boolean;
}

export interface AutopilotRunResult {
  ok: true;
  publishedIds: string[];
  created: {
    id: string;
    type: string;
    prompt: string;
    taskId: string | null;
  } | null;
  note: string | null;
  summary: string;
}

/**
 * خطوة أوتوبايلوت واحدة (idempotent — آمن استدعاؤها مرارًا):
 * 1) مسح مهام الأوتوبايلوت قيد التنفيذ: تحديث حالتها من kie.ai،
 *    وأي مهمة اكتملت بنجاح تُنشر تلقائيًا في المعرض العام.
 * 2) إذا لم توجد مهمة نشطة وcreate ≠ false: ينشئ مهمة جديدة (فيديو
 *    عمودي افتراضيًا) من قائمة المواضيع بالدوران.
 * قد ترمي Error عند فشل إنشاء المهمة (يعالجها المستدعي).
 */
export async function runAutopilotStep(
  options: AutopilotRunOptions
): Promise<AutopilotRunResult> {
  await ensureSchema();

  // 1) مسح المهام النشطة: متابعتها لدى المزوّد (وفق لقطة كل مهمة) ونشر ما اكتمل
  const publishedIds: string[] = [];
  const stillActive: string[] = [];
  const active = await listActiveAutopilot(5);

  for (const row of active) {
    let updated: Generation = row;
    if (row.taskId) {
      try {
        updated = await pollOnce(row.id, row);
        if (updated.status === "success" && updated.resultUrls.length > 0) {
          // النشر التلقائي الفوري في المعرض العام
          await updateGeneration(row.id, {
            published: true,
            publishedAt: Date.now(),
          });
          publishedIds.push(row.id);
          updated = { ...updated, published: true };
        }
      } catch (err) {
        console.error("[vi] autopilot poll failed:", err);
      }
    }
    if (isActiveStatus(updated.status)) stillActive.push(row.id);
  }

  // 2) إنشاء مهمة جديدة إذا لزم
  let created: AutopilotRunResult["created"] = null;
  let note: string | null = null;

  if (options.create === false) {
    note = "وضع المسح فقط — لم تُنشأ مهمة جديدة";
  } else if (stillActive.length > 0) {
    note = `توجد مهمة أوتوبايلوت قيد التنفيذ (${stillActive[0]}) — سيُنشر تلقائيًا عند اكتماله`;
  } else {
    const done = await countAutopilot();
    const plan = buildAutopilotPlan({
      type: options.type,
      prompt: options.prompt,
      topicIndex: done,
    });

    const gen = await startGeneration({
      type: plan.type,
      prompt: plan.prompt,
      aspectRatio: plan.params.aspectRatio,
      resolution: plan.params.resolution,
      duration: plan.params.duration,
      enableAudio: plan.params.enableAudio,
      autopilot: true,
    });
    created = {
      id: gen.id,
      type: gen.type,
      prompt: gen.prompt,
      taskId: gen.taskId,
    };
  }

  return {
    ok: true,
    publishedIds,
    created,
    note,
    summary: `نُشر ${publishedIds.length} عمل${created ? "، وأنشئت مهمة جديدة" : ""}`,
  };
}
