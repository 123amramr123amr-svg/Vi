import { buildAutopilotPlan } from "@/lib/autopilot";
import { getKieTask } from "@/lib/kie";
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

  // 1) مسح المهام النشطة: متابعتها لدى kie.ai ونشر ما اكتمل
  const publishedIds: string[] = [];
  const stillActive: string[] = [];
  const active = await listActiveAutopilot(5);

  for (const row of active) {
    let updated: Generation = row;
    if (row.taskId) {
      try {
        const task = await getKieTask(row.taskId);
        if (task.state === "success") {
          await updateGeneration(row.id, {
            status: "success",
            resultUrls: task.resultUrls,
            // النشر التلقائي الفوري في المعرض العام
            published: true,
            publishedAt: Date.now(),
          });
          publishedIds.push(row.id);
          updated = { ...row, status: "success", published: true };
        } else if (task.state === "fail") {
          await updateGeneration(row.id, {
            status: "fail",
            error: task.failMsg ?? "فشل التوليد",
          });
          updated = { ...row, status: "fail" };
        } else if (task.state !== row.status) {
          await updateGeneration(row.id, {
            status: task.state as Generation["status"],
          });
          updated = { ...row, status: task.state as Generation["status"] };
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
