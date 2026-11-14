import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { jobsPrefixes, providerHeaders } from "@/lib/provider";
import { getProviderSettings, normalizeBaseUrl } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({
  baseUrl: z.string().max(300).optional(),
  apiKey: z.string().max(400).optional(),
});

/**
 * POST /api/settings/test — فحص اتصال بالمزوّد بدون أي استهلاك للرصيد.
 * يرسل استعلامًا بريئيًا لمعرّف مهمة غير موجود (recordInfo) —
 * رفض التصديق (401/403) يعني أن المفتاح خاطئ، وأي رد آخر يعني
 * أن الخدمة تصل والمفتاح مقبول. لا يُنشئ أي مهمة توليد.
 */
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = body.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "المدخلات غير صالحة" }, { status: 400 });
  }
  const { baseUrl: rawBase, apiKey: rawKey } = parsed.data;

  try {
    const settings = await getProviderSettings();
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(rawBase ?? settings.baseUrl);
    } catch {
      return NextResponse.json(
        {
          error:
            "رابط الخدمة غير صالح — مثال: https://api.kie.ai أو https://openrouter.ai/api/v1",
        },
        { status: 400 }
      );
    }
    const apiKey = rawKey?.trim() || settings.apiKey || null;
    if (!apiKey) {
      return NextResponse.json(
        { error: "أدخل مفتاح API أولًا لاختبار الاتصال" },
        { status: 400 }
      );
    }

    const attempts: Array<{ endpoint: string; result: string }> = [];

    for (const prefix of jobsPrefixes(baseUrl)) {
      const endpoint = `${prefix}/recordInfo?taskId=vi-connection-check`;
      try {
        const res = await fetch(endpoint, {
          headers: providerHeaders(apiKey),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401 || res.status === 403) {
          attempts.push({ endpoint, result: `رفض التصديق (${res.status})` });
          return NextResponse.json({
            ok: false,
            authOk: false,
            attempts,
            error: `المفتاح مرفوض من المزوّد (${res.status}) — تأكد من صحته وأنه مفعّل، ثم أعد المحاولة`,
          });
        }
        const json = (await res.json().catch(() => null)) as unknown;
        const code =
          json && typeof json === "object"
            ? (json as Record<string, unknown>).code
            : null;
        if (typeof code === "number" && (code === 401 || code === 403)) {
          attempts.push({ endpoint, result: "رفض التصديق (رمز 401 في الرد)" });
          return NextResponse.json({
            ok: false,
            authOk: false,
            attempts,
            error:
              "المفتاح مرفوض من المزوّد — تأكد من صحته وأنه مفعّل، ثم أعد المحاولة",
          });
        }
        // أي رد آخر (حتى «مهمة غير موجودة») = التصديق ناجح والخدمة تصل
        attempts.push({
          endpoint,
          result: `مقبول (HTTP ${res.status}${typeof code === "number" ? ` — code ${code}` : ""})`,
        });
        return NextResponse.json({
          ok: true,
          authOk: true,
          endpoint,
          attempts,
          note: "الاتصال ناجح والمفتاح مقبول من المزوّد — إن استمر خطأ التوليد فالمشكلة في النموذج المختار أو الرصيد، وجرّب «جلب النماذج» واختيار نموذج آخر",
        });
      } catch (err) {
        attempts.push({
          endpoint,
          result: err instanceof Error ? err.message : "فشل الاتصال",
        });
      }
    }

    return NextResponse.json({
      ok: false,
      authOk: null,
      attempts,
      error: `تعذر الوصول إلى واجهة المهام لدى المزوّد (${baseUrl}) — تأكد من صحة الرابط`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر اختبار الاتصال" },
      { status: 502 }
    );
  }
}
