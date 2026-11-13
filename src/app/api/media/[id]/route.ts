import { NextRequest, NextResponse } from "next/server";
import { mediaContentEndpoints, providerHeaders } from "@/lib/provider";
import { getProviderSettings } from "@/lib/settings";
import { getGeneration } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/media/[id] — بروكسي محتوى الوسائط المُنتَجة.
 *
 * بعض المزوّدين (الواجهة المتوافقة مع OpenAI — نمط Sora) لا يرجعون رابطًا
 * عامًا للفيديو بل نقطة نهاية محتوى محمية بالمفتاح (/videos/{id}/content) —
 * هذا المسار يجلب المحتوى بالنيابة عن المستخدم ويُبثه كما هو.
 * يُستخدم تلقائيًا عندما تُسجَّل نتيجة المهمة كرابط داخلي /api/media/{id}.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const row = await getGeneration(id);
  if (!row || !row.taskId) {
    return NextResponse.json(
      { error: "لا يوجد محتوى مرتبط بهذا المعرّف" },
      { status: 404 }
    );
  }

  const settings = await getProviderSettings();
  const apiKey = settings.apiKey;
  if (!apiKey) {
    return NextResponse.json(
      { error: "لا يوجد مفتاح API مضبوط لجلب المحتوى من المزوّد" },
      { status: 500 }
    );
  }

  const endpoints = mediaContentEndpoints(
    row.params.provider?.baseUrl ?? settings.baseUrl,
    row.taskId,
    row.params.provider?.prefix
  );

  for (const endpoint of endpoints) {
    try {
      const upstream = await fetch(endpoint, {
        headers: providerHeaders(apiKey),
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      });
      if (!upstream.ok || !upstream.body) continue;
      return new Response(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      /* نجرّب المرشّح التالي */
    }
  }

  return NextResponse.json(
    { error: "تعذر جلب المحتوى من المزوّد" },
    { status: 502 }
  );
}
