import { createReadStream, existsSync, statSync } from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { buildMergedFile } from "@/lib/merge";
import { requestOrigin } from "@/lib/http";
import { ensureSchema, getMerge } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/merge/[id]/file — بث ملف الفيديو المدمج.
 * يبني الملف عند الحاجة (إن فُقد الكاش المؤقت) ويدعم ترويسة Range
 * حتى يعمل التشغيل والتمرير داخل <video> بسلاسة.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  const job = await getMerge(id);
  if (!job) {
    return NextResponse.json({ error: "وظيفة الدمج غير موجودة" }, { status: 404 });
  }
  if (job.status === "fail") {
    return NextResponse.json(
      { error: job.error ?? "فشل بناء الفيديو المدمج" },
      { status: 502 }
    );
  }

  let filePath: string;
  try {
    filePath = await buildMergedFile(job, requestOrigin(req));
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "تعذر بناء الفيديو المدمج — حاول بعد لحظات",
      },
      { status: 502 }
    );
  }

  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: "الملف المدمج غير متوفر حاليًا — أعد المحاولة" },
      { status: 404 }
    );
  }

  const size = statSync(filePath).size;
  const range = req.headers.get("range");

  /* دعم Range: bytes=start-end — للتمرير داخل مشغّل الفيديو */
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const stream = createReadStream(filePath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const stream = createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
