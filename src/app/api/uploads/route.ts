import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, insertUpload } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_BYTES = 4 * 1024 * 1024; // 4 ميجابايت (ضمن حدود حجم الطلب على Vercel)

/**
 * POST /api/uploads — رفع صورة (multipart/form-data، الحقل "file")
 * تُخزَّن في قاعدة البيانات وتُخدم على رابط عام:
 * GET /api/uploads/<id> — يستخدمه نموذج الفيديو في وضع image-to-video.
 */
export async function POST(req: NextRequest) {
  await ensureSchema();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "الطلب يجب أن يكون multipart/form-data مع حقل file" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "أرفق الصورة في حقل file" },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return NextResponse.json(
      { error: "صيغة الصورة غير مدعومة — المسموح: PNG أو JPG أو WebP" },
      { status: 400 }
    );
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "حجم الصورة يجب أن يكون بين 1 بايت و 4 ميجابايت" },
      { status: 400 }
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = crypto.randomUUID();
    await insertUpload({ id, mime: file.type, data: bytes });
    return NextResponse.json(
      { id, url: `/api/uploads/${id}`, size: bytes.byteLength, mime: file.type },
      { status: 201 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر حفظ الصورة";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
