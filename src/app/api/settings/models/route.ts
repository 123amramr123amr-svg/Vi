import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProviderSettings, normalizeBaseUrl } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  /** رابط الخدمة — إذا أُهمل استُخدم المحفوظ حاليًا */
  baseUrl: z.string().max(300).optional(),
  /** المفتاح المكتوب في النموذج — إذا أُهمل استُخدم المفتاح المحفوظ/البيئي */
  apiKey: z.string().max(400).optional(),
});

/** أنماط استخراج معرّفات النماذج من الردود المختلفة (kie / OpenAI / عام) */
function extractModelIds(json: unknown): string[] {
  let items: unknown[] = [];

  if (Array.isArray(json)) {
    items = json;
  } else if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    // ردود بنمط kie: {code: 401 | 200, data: ...}
    if (typeof obj.code === "number" && obj.code !== 200) return [];
    if (Array.isArray(obj.data)) items = obj.data;
    else if (Array.isArray((obj as { models?: unknown[] }).models))
      items = (obj as { models: unknown[] }).models;
    else if (
      obj.data &&
      typeof obj.data === "object" &&
      Array.isArray((obj.data as { models?: unknown[] }).models)
    ) {
      items = (obj.data as { models: unknown[] }).models;
    }
  }

  const ids = new Set<string>();
  for (const it of items) {
    let id: string | null = null;
    if (typeof it === "string") id = it;
    else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      for (const field of ["id", "model", "name", "value", "slug", "key"]) {
        if (typeof o[field] === "string" && (o[field] as string).trim()) {
          id = (o[field] as string).trim();
          break;
        }
      }
    }
    if (
      id &&
      id.length >= 2 &&
      id.length <= 200 &&
      /^[\w.:@\/\- ]+$/i.test(id)
    ) {
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

/** POST /api/settings/models — جلب قائمة النماذج المرتبطة بالمفتاح من المزوّد */
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
        { error: "رابط الخدمة غير صالح — مثال صحيح: https://api.kie.ai" },
        { status: 400 }
      );
    }
    const apiKey = rawKey?.trim() || settings.apiKey || null;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "أدخل مفتاح API أولًا في الحقل أعلاه، أو احفظ مفتاحًا مسبقًا قبل جلب النماذج",
        },
        { status: 400 }
      );
    }

    /* نجرب المسارات الشائعة: نمط kie ثم نمط OpenAI ثم المسار العام */
    const endpoints = [
      `${baseUrl}/api/v1/models`,
      `${baseUrl}/v1/models`,
      `${baseUrl}/models`,
    ];

    const tried: Array<{ endpoint: string; error: string }> = [];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        const json = (await res.json().catch(() => null)) as unknown;
        const models = extractModelIds(json);
        if (models.length > 0) {
          return NextResponse.json({
            ok: true,
            models,
            total: models.length,
            endpoint,
            source: "provider" as const,
          });
        }
        const msg =
          json && typeof json === "object" && "msg" in json
            ? String((json as { msg?: unknown }).msg)
            : `HTTP ${res.status}`;
        tried.push({ endpoint, error: msg });
      } catch (err) {
        tried.push({
          endpoint,
          error: err instanceof Error ? err.message : "فشل الاتصال",
        });
      }
    }

    // لم يدعم المزوّد جلب القائمة — نرجع الكتالوج المعروف + إدخال يدوي
    return NextResponse.json({
      ok: true,
      models: [],
      source: "catalog" as const,
      catalogSource: true,
      attempts: tried,
      note:
        "لم يدعم المزوّد جلب قائمة النماذج تلقائيًا — اختر من القائمة المعروفة أدناه أو اكتب معرّف النموذج يدويًا",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "تعذر جلب قائمة النماذج",
      },
      { status: 502 }
    );
  }
}
