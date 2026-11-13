import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getProviderSettings,
  normalizeBaseUrl,
  resetProviderSettings,
  saveProviderSettings,
  toPublicSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const putBody = z.object({
  /** رابط خدمة التوليد — مثال: https://api.kie.ai */
  baseUrl: z.string().min(4).max(300).optional(),
  /** مفتاح API جديد — غيابه أو null يعني عدم تغيير المفتاح الحالي */
  apiKey: z.string().max(400).nullable().optional(),
  /** إزالة المفتاح المخصص والرجوع إلى مفتاح متغيرات البيئة */
  clearApiKey: z.boolean().optional(),
  imageModel: z.string().min(1).max(200).optional(),
  videoModel: z.string().min(1).max(200).optional(),
});

/** GET /api/settings — الإعدادات الحالية (المفتاح يُعاد مُقنَّعًا فقط) */
export async function GET() {
  try {
    const settings = await getProviderSettings();
    return NextResponse.json({ settings: toPublicSettings(settings) });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "تعذر قراءة الإعدادات",
      },
      { status: 500 }
    );
  }
}

/** PUT /api/settings — حفظ الرابط/المفتاح/النماذج (تحديث جزئي) */
export async function PUT(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = putBody.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "المدخلات غير صالحة" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  try {
    if (body.baseUrl !== undefined) {
      // يرمي خطأ واضحًا إذا كان الرابط غير صالح
      normalizeBaseUrl(body.baseUrl);
    }
    const settings = await saveProviderSettings({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey ?? undefined,
      clearApiKey: body.clearApiKey,
      imageModel: body.imageModel,
      videoModel: body.videoModel,
    });
    return NextResponse.json({
      ok: true,
      settings: toPublicSettings(settings),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "تعذر حفظ الإعدادات",
      },
      { status: 400 }
    );
  }
}

/** DELETE /api/settings — استعادة الافتراضي (حذف الإعدادات المخصصة كلها) */
export async function DELETE() {
  try {
    const settings = await resetProviderSettings();
    return NextResponse.json({
      ok: true,
      message: "استُعيدت الإعدادات الافتراضية من متغيرات البيئة",
      settings: toPublicSettings(settings),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "تعذر استعادة الإعدادات",
      },
      { status: 500 }
    );
  }
}
