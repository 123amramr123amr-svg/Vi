import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getUpload } from "@/lib/turso";

export const dynamic = "force-dynamic";

/** GET /api/uploads/[id] — خدمة صورة مرفوعة (رابط عام يستخدمه مزوّد التوليد) */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await ctx.params;
  try {
    const up = await getUpload(id);
    if (!up) {
      return NextResponse.json({ error: "الصورة غير موجودة" }, { status: 404 });
    }
    return new Response(up.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": up.mime,
        "Content-Length": String(up.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "تعذر جلب الصورة" }, { status: 500 });
  }
}
