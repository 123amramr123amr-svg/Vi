import {
  CreateTaskError,
  createGenerationTask,
  ProviderAuthError,
  type ProviderSnapshot,
} from "@/lib/provider";
import { getProviderSettings } from "@/lib/settings";
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

/**
 * نماذج فيديو بديلة تُجرَّب تلقائيًا عند فشل النموذج المضبوط بخطأ من
 * المزوّد نفسه (مثل Internal error) بينما واجهة المهام حية — هذا يحل
 * مشكلة «خطأ داخلي يمنع إنشاء الفيديوهات» عندما يكون نموذج معين معطلًا.
 */
const VIDEO_TEXT_FALLBACKS = [
  "grok-imagine/text-to-video",
  "grok-imagine-video-1-5-preview",
];
const VIDEO_IMAGE_FALLBACKS = [
  "grok-imagine/image-to-video",
  "grok-imagine-video-1-5-preview",
];

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

  const settings = await getProviderSettings();
  const model =
    opts.extend && parent
      ? EXTEND_MODEL
      : opts.type === "image"
        ? settings.imageModel
        : settings.videoModel;

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

  /* ---- مقاسات الواجهة المتوافقة مع OpenAI (إن احتاجها المزوّد) ---- */
  const openaiImageSize = mapOpenaiImageSize(aspectRatio);
  const openaiVideoSpec = opts.extend
    ? undefined
    : {
        seconds: String(opts.duration ?? 8),
        size: mapOpenaiVideoSize(aspectRatio, resolution),
        ...(imgs.length > 0 ? { imageUrl: imgs[0] } : {}),
      };

  /* سلسلة النماذج المرشّحة: النموذج المضبوط أولًا ثم البدائل للفيديو فقط */
  const candidates = [model];
  if (opts.type === "video" && !(opts.extend && parent)) {
    for (const fb of imgs.length > 0 ? VIDEO_IMAGE_FALLBACKS : VIDEO_TEXT_FALLBACKS) {
      if (fb !== model && !candidates.includes(fb)) candidates.push(fb);
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
    /* إنشاء المهمة: واجهة المهام (نمط kie) أولًا ثم المتوافق مع OpenAI —
       وعند فشل نموذج الفيديو من المزوّد نفسه تُجرَّب النماذج البديلة تلقائيًا */
    let lastError: unknown = null;
    for (let ci = 0; ci < candidates.length; ci++) {
      const candidate = candidates[ci]!;
      try {
        const created = await createGenerationTask({
          type: opts.type,
          model: candidate,
          input,
          prompt: opts.prompt,
          cfg: { baseUrl: settings.baseUrl, apiKey: settings.apiKey },
          jobsOnly: Boolean(opts.extend && parent),
          ...(opts.type === "image" ? { openaiImageSize } : { openaiVideo: openaiVideoSpec }),
        });

        /* لقطة المزوّد تُحفظ مع المهمة حتى يستعلام الاستمرار لدى نفس المزوّد الذي أُنشئت به */
        const snapshot: ProviderSnapshot = {
          kind: created.kind,
          baseUrl: settings.baseUrl,
          prefix: created.prefix,
        };
        const finalParams = { ...gen.params, provider: snapshot };

        if (created.immediateUrls.length > 0) {
          // واجهة متزامنة (مثل /images/generations) — النتيجة جاهزة فورًا
          await updateGeneration(gen.id, {
            model: candidate,
            taskId: created.taskId,
            status: "success",
            resultUrls: created.immediateUrls,
            params: finalParams,
          });
          return {
            ...gen,
            model: candidate,
            taskId: created.taskId,
            status: "success",
            resultUrls: created.immediateUrls,
            params: finalParams,
            updatedAt: Date.now(),
          };
        }

        if (!created.taskId) {
          throw new Error("لم يُرجع المزوّد معرّف المهمة");
        }
        await updateGeneration(gen.id, {
          model: candidate,
          taskId: created.taskId,
          status: "waiting",
          params: finalParams,
        });
        return {
          ...gen,
          model: candidate,
          taskId: created.taskId,
          status: "waiting",
          params: finalParams,
          updatedAt: Date.now(),
        };
      } catch (err) {
        /* مفتاح مرفوض = لا فائدة من تجربة نموذج آخر بنفس المفتاح */
        if (err instanceof ProviderAuthError) throw err;
        lastError = err;
        const live = err instanceof CreateTaskError && err.jobsEndpointLive;
        /* نجرّب النموذج البديل فقط عندما واجهة المزوّد حية وفشل هو النموذج نفسه */
        if (!live || ci >= candidates.length - 1) throw err;
        console.warn(
          `[generate] فشل النموذج "${candidate}" عند المزوّد — جارٍ تجربة البديل "${candidates[ci + 1]}"`,
          err instanceof Error ? err.message : err
        );
      }
    }
    throw lastError ?? new Error("تعذر إنشاء مهمة التوليد عند المزوّد");
  } catch (err) {
    const raw =
      err instanceof Error
        ? err.message
        : "تعذر إنشاء مهمة التوليد عند المزوّد";
    const message = withProviderHint(raw);
    try {
      await updateGeneration(gen.id, { status: "fail", error: message });
    } catch {
      /* قاعدة البيانات غير متاحة أيضًا */
    }
    throw new Error(message);
  }
}

/**
 * تصنيف رسالة فشل المزوّد وإضافة توصية عملية بالعربية — بدل رسالة
 * «خطأ داخلي» بلا سياق يفهم منها المستخدم ما الذي يجب فعله.
 */
function withProviderHint(message: string): string {
  const s = message.toLowerCase();
  let hint: string | null = null;
  if (/insufficient|credit|balance|quota|billing/.test(s)) {
    hint =
      "الرصيد لدى المزوّد غير كافٍ — اشحن الحساب أو استخدم مفتاحًا آخر من تبويب الإعدادات.";
  } else if (/invalid api key|unauthorized|forbidden|authentication/.test(s)) {
    hint =
      "المفتاح مرفوض من المزوّد — تأكد من لصق المفتاح الصحيح في تبويب الإعدادات ثم اضغط «اختبار الاتصال».";
  } else if (/internal/.test(s)) {
    hint =
      "المزوّد أرجع خطأً داخليًا (عطلًا مؤقتًا أو نموذجًا معطلًا) — جُرّبت نماذج بديلة تلقائيًا؛ إن تكرر الخطأ اختر نموذجًا آخر من تبويب الإعدادات أو حاول لاحقًا.";
  } else if (/model/.test(s)) {
    hint =
      "قد يكون معرّف النموذج غير صحيح أو غير مدعوم — اختر النموذج من قائمة «جلب النماذج» في تبويب الإعدادات.";
  }
  return hint ? `${message}\n💡 ${hint}` : message;
}

/* ------- مقاسات الواجهة المتوافقة مع OpenAI ------- */

/** تحويل نسبة الأبعاد إلى مقاس صورة تقريبي (نمط gpt-image) */
function mapOpenaiImageSize(aspectRatio?: string): string {
  switch (aspectRatio) {
    case "16:9":
    case "3:2":
    case "4:3":
    case "21:9":
    case "2:1":
    case "5:4":
    case "3:1":
      return "1536x1024";
    case "9:16":
    case "2:3":
    case "3:4":
    case "4:5":
    case "1:2":
    case "9:21":
    case "1:3":
      return "1024x1536";
    default:
      return "1024x1024";
  }
}

/** تحويل نسبة الأبعاد والدقة إلى مقاس فيديو تقريبي (نمط Sora) */
function mapOpenaiVideoSize(aspectRatio?: string, resolution?: string): string {
  const portrait = aspectRatio === "9:16" || aspectRatio === "2:3" || aspectRatio === "3:4";
  const square = aspectRatio === "1:1";
  const res = resolution === "1080p" ? 1080 : resolution === "480p" ? 480 : 720;
  if (square) {
    const s = res === 1080 ? 1024 : 720;
    return `${s}x${s}`;
  }
  const h = res;
  const w = portrait
    ? Math.round((res * 9) / 16 / 2) * 2
    : Math.round((res * 16) / 9 / 2) * 2;
  return portrait ? `${h}x${w}` : `${w}x${h}`;
}
