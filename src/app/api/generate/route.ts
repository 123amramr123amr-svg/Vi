import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startGeneration } from "@/lib/tasks";
import {
  IMAGE_ASPECT_RATIOS,
  VIDEO_ASPECT_RATIOS,
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

  try {
    const gen = await startGeneration({
      type: body.type,
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      ...(body.type === "video"
        ? { duration: body.duration, enableAudio: body.enableAudio }
        : {}),
    });
    return NextResponse.json(
      { id: gen.id, taskId: gen.taskId, status: gen.status },
      { status: 201 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء إنشاء المهمة";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
