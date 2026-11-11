import { NextRequest, NextResponse } from "next/server";
import { buildAutopilotPlan } from "@/lib/autopilot";
import { createKieTask, getKieTask, IMAGE_MODEL, VIDEO_MODEL } from "@/lib/kie";
import {
  countAutopilot,
  ensureSchema,
  insertGeneration,
  listActiveAutopilot,
  updateGeneration,
} from "@/lib/turso";
import { isActiveStatus, type Generation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * التحقق من هوية المتصل:
 * - إذا لم يُضبط AUTOPILOT_TOKEN أو CRON_SECRET على الخادم: مفتوح للجميع.
 * - إذا ضُبط أحدهما: يُقبل Authorization: Bearer <token> (يرسله Vercel Cron
 *   تلقائيًا) أو ترويسة x-autopilot-token (يرسلها زر الواجهة / ChatGPT).
 */
function isAuthorized(req: NextRequest): boolean {
  const expected =
    process.env.AUTOPILOT_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (!expected) return true;
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const header = req.headers.get("x-autopilot-token")?.trim();
  return bearer === expected || header === expected;
}

interface AutopilotOptions {
  type?: "image" | "video";
  prompt?: string;
  /** false = مسح ونشر فقط دون إنشاء مهمة جديدة */
  create?: boolean;
}

/**
 * خطوة أوتوبايلوت واحدة (idempotent — آمن استدعاؤها مرارًا):
 * 1) مسح مهام الأوتوبايلوت قيد التنفيذ: تحديث حالتها من kie.ai،
 *    وأي مهمة اكتملت بنجاح تُنشر تلقائيًا في المعرض العام.
 * 2) إذا لم توجد مهمة نشطة وcreate ≠ false: ينشئ مهمة جديدة (فيديو
 *    عمودي افتراضيًا) من قائمة المواضيع بالدوران.
 *
 * يعمل عبر: GET/POST /api/autopilot/run
 * - Vercel Cron يوميًا (vercel.json) بنشر أمس وإنشاء مهمة اليوم.
 * - زر «شغّل الآن» في تبويب النشر التلقائي.
 * - ChatGPT عبر الـ Action runAutopilot.
 */
async function runStep(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "توكن الأوتوبايلوت غير صحيح" }, { status: 401 });
  }
  await ensureSchema();

  const options: AutopilotOptions =
    req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as AutopilotOptions)
      : {
          type:
            req.nextUrl.searchParams.get("type") === "image" ? "image" : undefined,
          prompt: req.nextUrl.searchParams.get("prompt") ?? undefined,
          create: req.nextUrl.searchParams.get("create") !== "false",
        };

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
          await updateGeneration(row.id, { status: task.state as Generation["status"] });
          updated = { ...row, status: task.state as Generation["status"] };
        }
      } catch (err) {
        console.error("[vi] autopilot poll failed:", err);
      }
    }
    if (isActiveStatus(updated.status)) stillActive.push(row.id);
  }

  // 2) إنشاء مهمة جديدة إذا لزم
  let created: { id: string; type: string; prompt: string; taskId: string | null } | null =
    null;
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
    const model = plan.type === "image" ? IMAGE_MODEL : VIDEO_MODEL;
    const id = crypto.randomUUID();
    const now = Date.now();

    const input: Record<string, unknown> =
      plan.type === "image"
        ? {
            prompt: plan.prompt,
            aspect_ratio: plan.params.aspectRatio,
            resolution: plan.params.resolution,
            output_format: "png",
          }
        : {
            prompt: plan.prompt,
            aspect_ratio: plan.params.aspectRatio,
            resolution: plan.params.resolution,
            duration: plan.params.duration,
            enable_audio: plan.params.enableAudio,
          };

    const gen: Generation = {
      id,
      taskId: null,
      type: plan.type,
      model,
      prompt: plan.prompt,
      params: plan.params,
      status: "pending",
      resultUrls: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      published: false,
      publishedAt: null,
    };

    try {
      await insertGeneration(gen);
      const taskId = await createKieTask(model, input);
      await updateGeneration(id, { taskId, status: "waiting" });
      created = { id, type: plan.type, prompt: plan.prompt, taskId };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "تعذر إنشاء مهمة الأوتوبايلوت";
      console.error("[vi] autopilot create failed:", err);
      try {
        await updateGeneration(id, { status: "fail", error: message });
      } catch {
        /* قاعدة البيانات غير متاحة أيضًا */
      }
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  return NextResponse.json({
    ok: true,
    publishedIds,
    created,
    note,
    summary: `نُشر ${publishedIds.length} عمل${created ? "، وأنشئت مهمة جديدة" : ""}`,
  });
}

export async function GET(req: NextRequest) {
  return runStep(req);
}

export async function POST(req: NextRequest) {
  return runStep(req);
}
