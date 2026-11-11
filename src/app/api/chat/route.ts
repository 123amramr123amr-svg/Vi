import { NextRequest, NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  chatComplete,
  resolveChatProvider,
  type ChatMessage,
} from "@/lib/ai-chat";
import {
  clearChatMessages,
  ensureSchema,
  insertChatMessage,
  listChatMessages,
} from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/chat — سجل المحادثة من قاعدة البيانات
 */
export async function GET() {
  await ensureSchema();
  const messages = await listChatMessages(50);
  return NextResponse.json({ messages });
}

/**
 * DELETE /api/chat — مسح سجل المحادثة
 */
export async function DELETE() {
  await ensureSchema();
  await clearChatMessages();
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/chat — إرسال رسالة للمساعد الذكي.
 * Body: { message: string }
 * Header اختياري: x-openai-key — مفتاح OpenAI الخاص بالمستخدم.
 */
export async function POST(req: NextRequest) {
  await ensureSchema();

  const raw = (await req.json().catch(() => null)) as
    | { message?: unknown }
    | null;
  const message =
    typeof raw?.message === "string" ? raw.message.trim().slice(0, 8000) : "";
  if (!message) {
    return NextResponse.json({ error: "الرسالة مطلوبة" }, { status: 400 });
  }

  const userOpenAiKey = req.headers.get("x-openai-key")?.slice(0, 250) ?? null;
  const provider = resolveChatProvider(userOpenAiKey);
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "لا يوجد مزوّد محادثة مضبوط — أضف KIE_API_KEY أو OPENAI_API_KEY إلى الخادم، أو مفتاح OpenAI من الإعدادات.",
      },
      { status: 500 }
    );
  }

  try {
    await insertChatMessage("user", message);

    // بناء سياق المحادثة من قاعدة البيانات (آخر 16 رسالة)
    const history = await listChatMessages(16);
    const context: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const reply = await chatComplete(provider, context);
    await insertChatMessage("assistant", reply);

    return NextResponse.json({
      reply,
      provider: provider.label,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء المحادثة";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
