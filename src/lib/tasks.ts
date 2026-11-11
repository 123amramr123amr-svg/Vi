import { createKieTask, IMAGE_MODEL, VIDEO_MODEL } from "@/lib/kie";
import { ensureSchema, insertGeneration, updateGeneration } from "@/lib/turso";
import type { Generation } from "@/lib/types";

/**
 * خدمة إنشاء مهام التوليد المشتركة — تستخدمها:
 * POST /api/generate (الواجهة + OpenAPI Actions)، أدوات MCP، والأوتوبايلوت.
 */

export interface StartGenerationOptions {
  type: "image" | "video";
  prompt: string;
  aspectRatio: string;
  resolution: string;
  /** للفيديو فقط: طول المقطع بالثواني (1-15) */
  duration?: number;
  /** للفيديو فقط: توليد صوت */
  enableAudio?: boolean;
  /** صحيح إذا أنشأتها الأوتوبايلوت (تُنشر تلقائيًا عند الاكتمال) */
  autopilot?: boolean;
}

/** إنشاء صف في قاعدة البيانات + مهمة لدى kie.ai، وإرجاع الصف بعد التحديث */
export async function startGeneration(
  opts: StartGenerationOptions
): Promise<Generation> {
  await ensureSchema();

  const model = opts.type === "image" ? IMAGE_MODEL : VIDEO_MODEL;
  const input: Record<string, unknown> =
    opts.type === "image"
      ? {
          prompt: opts.prompt,
          aspect_ratio: opts.aspectRatio,
          resolution: opts.resolution,
          output_format: "png",
        }
      : {
          prompt: opts.prompt,
          aspect_ratio: opts.aspectRatio,
          resolution: opts.resolution,
          duration: opts.duration ?? 8,
          enable_audio: opts.enableAudio ?? true,
        };

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
            aspectRatio: opts.aspectRatio,
            resolution: opts.resolution,
            ...(opts.autopilot ? { autopilot: true } : {}),
          }
        : {
            aspectRatio: opts.aspectRatio,
            resolution: opts.resolution,
            duration: opts.duration ?? 8,
            enableAudio: opts.enableAudio ?? true,
            ...(opts.autopilot ? { autopilot: true } : {}),
          },
    status: "pending",
    resultUrls: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    published: false,
    publishedAt: null,
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
