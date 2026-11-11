import { createKieTask, IMAGE_MODEL, VIDEO_MODEL } from "@/lib/kie";
import {
  ensureSchema,
  getGeneration,
  insertGeneration,
  updateGeneration,
} from "@/lib/turso";
import type { Generation } from "@/lib/types";

/**
 * خدمة إنشاء مهام التوليد المشتركة — تستخدمها:
 * POST /api/generate (الواجهة + OpenAPI Actions)، أدوات MCP، والأوتوبايلوت.
 */

/** نموذج تكملة الفيديو الرسمي من kie.ai (Grok Imagine - Video Extend) */
const EXTEND_MODEL = process.env.KIE_EXTEND_MODEL ?? "grok-imagine/extend";

/** خطأ في طلب إنشاء التوليد (يرد للعميل كـ 400 وليس 502) */
export class GenerationRequestError extends Error {}

export interface StartGenerationOptions {
  type: "image" | "video";
  prompt: string;
  /** عند التكملة يمكن إهماله ليرث نسبة أبعاد الفيديو الأصلي */
  aspectRatio?: string;
  /** عند التكملة يمكن إهماله ليرث دقة الفيديو الأصلي */
  resolution?: string;
  /** للفيديو فقط: طول المقطع بالثواني (1-15) — وفي التكملة التلقائية هو مدة الجزء الجديد */
  duration?: number;
  /** للفيديو فقط: توليد صوت */
  enableAudio?: boolean;
  /** صحيح إذا أنشأتها الأوتوبايلوت (تُنشر تلقائيًا عند الاكتمال) */
  autopilot?: boolean;
  /** تكملة الفيديو: معرّف جزء سابق مكتمل يرتبط به الجزء الجديد */
  parentId?: string;
  /** صور عامة الروابط يحركها النموذج (image-to-video) — للفيديو فقط */
  imageUrls?: string[];
  /** تكملة تلقائية عبر نموذج grok-imagine/extend (يُكمل نفس الفيديو من نهايته) */
  extend?: boolean;
  /** ثانية بداية التكملة داخل الفيديو الأصلي (0 = من النهاية وفق أمثلة المزوّد) */
  extendAt?: number;
}

/** إنشاء صف في قاعدة البيانات + مهمة لدى kie.ai، وإرجاع الصف بعد التحديث */
export async function startGeneration(
  opts: StartGenerationOptions
): Promise<Generation> {
  await ensureSchema();

  /* ---- التحقق من صلاحية التكملة قبل أي شيء (وف قبل أي استدعاء للمزوّد) ---- */
  let parent: Generation | null = null;
  let partNumber: number | null = null;

  if (opts.parentId) {
    if (opts.type !== "video") {
      throw new GenerationRequestError(
        "تكملة السلسلة متاحة لمهام الفيديو فقط"
      );
    }
    parent = await getGeneration(opts.parentId);
    if (!parent) {
      throw new GenerationRequestError(
        "الفيديو الأصلي المراد تكملته غير موجود في السجل"
      );
    }
    if (parent.type !== "video") {
      throw new GenerationRequestError(
        "العنصر الأصلي صورة وليس فيديو — لا يمكن تكملته"
      );
    }
    if (parent.status !== "success" || parent.resultUrls.length === 0) {
      throw new GenerationRequestError(
        "يجب أن يكتمل الفيديو الأصلي بنجاح قبل تكملته"
      );
    }
    if (!parent.taskId) {
      throw new GenerationRequestError(
        "لا يوجد معرّف مهمة للفيديو الأصلي — تعذر ربط التكملة به"
      );
    }
    partNumber = (parent.partNumber ?? 1) + 1;
    // الفيديو الأصلي يصبح رسميًا «الجزء 1» عند أول تكملة له
    if (parent.partNumber == null) {
      try {
        await updateGeneration(parent.id, { partNumber: 1 });
      } catch {
        /* تحسين تجميلي — لا يعطل التكملة */
      }
    }
  }

  const model =
    opts.extend && parent
      ? EXTEND_MODEL
      : opts.type === "image"
        ? IMAGE_MODEL
        : VIDEO_MODEL;

  /* ---- بناء مدخلات المزوّد وفق توثيق كل نموذج ---- */
  const imgs = (opts.imageUrls ?? []).map((u) => u.trim()).filter(Boolean);

  // عند التكملة: وراثة نسبة الأبعاد والدقة من الفيديو الأصلي ليتناسق الجزء الجديد معه
  const aspectRatio =
    opts.aspectRatio && opts.aspectRatio !== "auto"
      ? opts.aspectRatio
      : (parent?.params.aspectRatio ?? opts.aspectRatio ?? "auto");
  const resolution =
    opts.resolution ?? parent?.params.resolution ?? (opts.type === "image" ? "1K" : "720p");

  let input: Record<string, unknown>;

  if (opts.extend && parent) {
    // Grok Imagine - Video Extend: يُكمل نفس الفيديو (المدخلات: task_id/prompt/extend_at/extend_times)
    input = {
      task_id: parent.taskId,
      prompt: opts.prompt,
      extend_at: opts.extendAt ?? 0,
      extend_times: String(opts.duration ?? 8),
    };
  } else if (opts.type === "image") {
    input = {
      prompt: opts.prompt,
      aspect_ratio: aspectRatio,
      resolution,
      output_format: "png",
    };
  } else {
    input = {
      prompt: opts.prompt,
      aspect_ratio: aspectRatio,
      resolution,
      duration: opts.duration ?? 8,
      enable_audio: opts.enableAudio ?? true,
    };
    if (imgs.length > 0) {
      input.image_urls = imgs;
    }
  }

  const now = Date.now();
  const gen: Generation = {
    id: crypto.randomUUID(),
    taskId: null,
    type: opts.type,
    model,
    prompt: opts.prompt,
    params:
      opts.type === "image"
        ? {
            aspectRatio,
            resolution,
            ...(opts.autopilot ? { autopilot: true } : {}),
          }
        : {
            aspectRatio,
            resolution,
            duration: opts.duration ?? 8,
            enableAudio: opts.enableAudio ?? true,
            ...(opts.autopilot ? { autopilot: true } : {}),
            ...(imgs.length > 0 ? { imageUrls: imgs } : {}),
            ...(opts.extend && parent ? { extendAt: opts.extendAt ?? 0 } : {}),
          },
    status: "pending",
    resultUrls: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    published: false,
    publishedAt: null,
    parentId: parent?.id ?? null,
    partNumber,
  };

  await insertGeneration(gen);
  try {
    const taskId = await createKieTask(model, input);
    await updateGeneration(gen.id, { taskId, status: "waiting" });
    return { ...gen, taskId, status: "waiting", updatedAt: Date.now() };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "تعذر إنشاء مهمة التوليد عند المزوّد";
    try {
      await updateGeneration(gen.id, { status: "fail", error: message });
    } catch {
      /* قاعدة البيانات غير متاحة أيضًا */
    }
    throw new Error(message);
  }
}
