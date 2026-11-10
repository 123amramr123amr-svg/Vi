import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createKieTask, IMAGE_MODEL, VIDEO_MODEL } from "@/lib/kie";
import { ensureSchema, insertGeneration, updateGeneration } from "@/lib/turso";
import {
  IMAGE_ASPECT_RATIOS,
  VIDEO_ASPECT_RATIOS,
  type Generation,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const imageBody = z.object({
  type: z.literal("image"),
  prompt: z.string().trim().min(1, "الوصف مطلوب").max(20000, "الوصف طويل جدًا"),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).default("auto"),
  resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
});

const videoBody = z.object({
  type: z.literal("video"),
  prompt: z.string().trim().min(1, "الوصف مطلوب").max(4096, "الوصف طويل جدًا"),
  aspectRatio: z.enum(VIDEO_ASPECT_RATIOS).default("auto"),
  resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
  duration: z.coerce.number().int().min(1).max(15).default(8),
  enableAudio: z.boolean().default(true),
});

const bodySchema = z.discriminatedUnion("type", [imageBody, videoBody]);

/** POST /api/generate — إنشاء مهمة توليد صورة أو فيديو جديدة */
export async function POST(req: NextRequest) {
  await ensureSchema();

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "المدخلات غير صالحة" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const now = Date.now();
  const id = crypto.randomUUID();
  const model = body.type === "image" ? IMAGE_MODEL : VIDEO_MODEL;

  const input: Record<string, unknown> =
    body.type === "image"
      ? {
          prompt: body.prompt,
          aspect_ratio: body.aspectRatio,
          resolution: body.resolution,
          output_format: "png",
        }
      : {
          prompt: body.prompt,
          aspect_ratio: body.aspectRatio,
          resolution: body.resolution,
          duration: body.duration,
          enable_audio: body.enableAudio,
        };

  const gen: Generation = {
    id,
    taskId: null,
    type: body.type,
    model,
    prompt: body.prompt,
    params:
      body.type === "image"
        ? { aspectRatio: body.aspectRatio, resolution: body.resolution }
        : {
            aspectRatio: body.aspectRatio,
            resolution: body.resolution,
            duration: body.duration,
            enableAudio: body.enableAudio,
          },
    status: "pending",
    resultUrls: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await insertGeneration(gen);
    const taskId = await createKieTask(model, input);
    await updateGeneration(id, { taskId, status: "waiting" });
    return NextResponse.json({ id, taskId, status: "waiting" }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء إنشاء المهمة";
    try {
      await updateGeneration(id, { status: "fail", error: message });
    } catch {
      /* لا شيء — قاعدة البيانات غير متاحة أيضًا */
    }
    return NextResponse.json({ id, error: message }, { status: 502 });
  }
}
