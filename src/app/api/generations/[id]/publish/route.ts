import { NextRequest, NextResponse } from "next/server";
import {
  ensureSchema,
  getGeneration,
  updateGeneration,
} from "@/lib/turso";

export const dynamic = "force-dynamic";

/**
 * PUT /api/generations/[id]/publish — نشر العمل في المعرض العام /gallery.
 * متاح أيضًا كـ Action لـ ChatGPT (publishGeneration).
 */
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  const row = await getGeneration(id);
  if (!row) {
    return NextResponse.json({ error: "العنصر غير موجود" }, { status: 404 });
  }
  if (row.status !== "success" || row.resultUrls.length === 0) {
    return NextResponse.json(
      { error: "لا يمكن النشر إلا بعد اكتمال التوليد بنجاح" },
      { status: 400 }
    );
  }
  if (!row.published) {
    await updateGeneration(id, { published: true, publishedAt: Date.now() });
  }

  const updated = await getGeneration(id);
  return NextResponse.json({ ok: true, item: updated });
}

/**
 * DELETE /api/generations/[id]/publish — إلغاء النشر من المعرض العام.
 * (يُبقي العمل في السجل الخاص، فقط يخفيه من المعرض)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  const row = await getGeneration(id);
  if (!row) {
    return NextResponse.json({ error: "العنصر غير موجود" }, { status: 404 });
  }
  if (row.published) {
    await updateGeneration(id, { published: false, publishedAt: null });
  }

  const updated = await getGeneration(id);
  return NextResponse.json({ ok: true, item: updated });
}
