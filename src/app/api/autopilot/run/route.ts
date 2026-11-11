import { NextRequest, NextResponse } from "next/server";
import { runAutopilotStep, type AutopilotRunOptions } from "@/lib/autopilot-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * التحقق من هوية المتصل:
 * - إذا لم يُضبط AUTOPILOT_TOKEN أو CRON_SECRET على الخادم: مفتوح للجميع.
 * - إذا ضُبط أحدهما: يُقبل Authorization: Bearer <token> (يرسله Vercel Cron
 *   تلقائيًا) أو ترويسة x-autopilot-token (يرسلها زر الواجهة / ChatGPT).
 */
function isAuthorized(req: NextRequest): boolean {
  const expected =
    process.env.AUTOPILOT_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (!expected) return true;
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const header = req.headers.get("x-autopilot-token")?.trim();
  return bearer === expected || header === expected;
}

/**
 * GET/POST /api/autopilot/run — خطوة أوتوبايلوت واحدة:
 * - Vercel Cron يوميًا (vercel.json) بنشر ما اكتمل وإنشاء مهمة اليوم.
 * - زر «شغّل الآن» في تبويب النشر التلقائي.
 * - ChatGPT عبر الـ Action runAutopilot.
 * المنطق الفعلي في src/lib/autopilot-runner.ts (مشترك مع أداة MCP run_autopilot).
 */
async function runStep(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "توكن الأوتوبايلوت غير صحيح" },
      { status: 401 }
    );
  }

  const options: AutopilotRunOptions =
    req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as AutopilotRunOptions)
      : {
          type:
            req.nextUrl.searchParams.get("type") === "image" ? "image" : undefined,
          prompt: req.nextUrl.searchParams.get("prompt") ?? undefined,
          create: req.nextUrl.searchParams.get("create") !== "false",
        };

  try {
    const result = await runAutopilotStep(options);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر تنفيذ خطوة الأوتوبايلوت";
    console.error("[vi] autopilot run failed:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return runStep(req);
}

export async function POST(req: NextRequest) {
  return runStep(req);
}
