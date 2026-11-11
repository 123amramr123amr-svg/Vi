import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GenerationRequestError, startGeneration } from "@/lib/tasks";
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
  /* ----- تكملة الفيديو (سلسلة أجزاء) ----- */
  /** معرّف جزء سابق مكتمل — الجزء الجديد يرتبط به كتكملة */
  parentId: z.string().uuid("معرّف الفيديو الأصلي غير صالح").optional(),
  /** روابط صور عامة يحركها النموذج كالجزء الجديد (حتى 3 صور) */
  imageUrls: z.array(z.string().min(1).max(2000)).max(3, "الحد الأقصى 3 صور").optional(),
  /** تكملة تلقائية عبر نموذج المزوّد grok-imagine/extend (يُكمل نفس الفيديو من نهايته) */
  extend: z.boolean().optional(),
  /** ثانية بداية التكملة داخل الفيديو الأصلي (0 = من النهاية وفق أمثلة المزوّد) */
  extendAt: z.coerce.number().int().min(0).max(120).optional(),
});

const bodySchema = z.discriminatedUnion("type", [imageBody, videoBody]);

/** بناء رابط مطلق من ترويسات الطلب (يعمل على localhost وعلى Vercel) */
function getBaseUrl(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "localhost:3000";
  const protoHeader = req.headers.get("x-forwarded-proto");
  const proto = protoHeader
    ? protoHeader.split(",")[0]!.trim()
    : host.includes("localhost") || host.startsWith("127.")
      ? "http"
      : "https";
  return `${proto}://${host}`;
}

/**
 * توحيد روابط الصور: يقبل رابطًا عامًا https:// أو مسارًا داخليًا
 * مثل /api/uploads/<id> (يُرفع عبر POST /api/uploads) ويحوله لرابط مطلق.
 */
function absolutizeImageUrl(raw: string, base: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${base}${s}`;
  return null;
}

/** POST /api/generate — إنشاء مهمة توليد صورة أو فيديو جديدة (أو تكملة فيديو) */
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

  /* توحيد روابط الصور (للفيديو فقط) */
  let imageUrls: string[] | undefined;
  if (body.type === "video" && body.imageUrls && body.imageUrls.length > 0) {
    const base = getBaseUrl(req);
    const urls: string[] = [];
    for (const u of body.imageUrls) {
      const abs = absolutizeImageUrl(u, base);
      if (!abs) {
        return NextResponse.json(
          {
            error:
              "رابط صورة غير صالح — استخدم رابطًا عامًا يبدأ بـ https أو ارفع الصورة أولًا عبر POST /api/uploads",
          },
          { status: 400 }
        );
      }
      urls.push(abs);
    }
    imageUrls = urls;
  }

  try {
    const gen = await startGeneration({
      type: body.type,
      prompt: body.prompt,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      ...(body.type === "video"
        ? {
            duration: body.duration,
            enableAudio: body.enableAudio,
            parentId: body.parentId,
            extend: body.extend,
            extendAt: body.extendAt,
            imageUrls,
          }
        : {}),
    });
    return NextResponse.json(
      {
        id: gen.id,
        taskId: gen.taskId,
        status: gen.status,
        parentId: gen.parentId,
        partNumber: gen.partNumber,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof GenerationRequestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء إنشاء المهمة";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
