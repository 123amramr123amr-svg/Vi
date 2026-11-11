/**
 * مزوّد المحادثة الذكي (شات جي بي تي) لاستوديو Vi.
 *
 * أولوية المزوّدين:
 * 1. مفتاح OpenAI الخاص بالمستخدم (يُرسل من المتصفح عبر ترويسة x-openai-key)
 * 2. متغير البيئة OPENAI_API_KEY (إن وُجد)
 * 3. نماذج المحادثة لدى kie.ai بنفس مفتاح KIE_API_KEY الموجود أصلًا (افتراضي)
 *
 * كلا المزوّدين يستخدم صيغة OpenAI Chat Completions المتوافقة.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatProviderConfig {
  url: string;
  apiKey: string;
  /** null يعني أن اسم النموذج مضمر في المسار (kie.ai) ولا يُرسل في الجسم */
  model: string | null;
  label: string;
}

export const SYSTEM_PROMPT = `أنت "مساعد Vi" — مساعد ذكي (مثل شات جي بي تي) داخل استوديو Vi لتوليد الصور والفيديو بالذكاء الاصطناعي.

قواعدك:
- جاوب بالعربية بإيجاز ووضوح، إلا إذا كتب المستخدم بلغة أخرى فجاوب بلغته.
- مهمتك الأساسية: مساعدة المستخدم في صياغة أوصاف (Prompts) احترافية لتوليد الصور والفيديو، واقتراح أفكار إبداعية، والإجابة عن أسئلته العامة باختصار.
- النماذج المتاحة في الاستوديو:
  • الصور: gpt-image-2-6/flare-text-to-image — يدعم نسب الأبعاد (auto, 1:1, 16:9, 9:16, 4:3...) والدقة (1K, 2K, 4K).
  • الفيديو: grok-imagine-video-1-5-preview — المدة من 1 إلى 15 ثانية، الدقة (480p, 720p, 1080p)، مع صوت تلقائي.
- عندما يريد المستخدم توليد صورة أو فيديو فعليًا، صِغ له وصفًا نهائيًا غنيًا بالتفاصيل البصرية (الموضوع، الأسلوب، الإضاءة، زاوية الكاميرا، الجو العام) ثم أضف في نهاية ردك كتلة بالضبط بهذا الشكل:
\`\`\`vi-generate
{"type":"image","prompt":"الوصف الجاهز الكامل"}
\`\`\`
وللفيديو:
\`\`\`vi-generate
{"type":"video","prompt":"الوصف الجاهز الكامل","duration":8,"resolution":"720p"}
\`\`\`
- مهم جدًا: لا تستخدم أي أدوات داخلية خاصة بك مطلقًا (مثل أدوات توليد الصور أو الفيديو أو web_search أو code_interpreter). الاستوديو يعالج كتلة vi-generate بنفسه عبر نماذج المستخدم المدفوعة (gpt-image-2-6/flare-text-to-image و grok-imagine-video-1-5-preview). ردك هو نص فقط + كتلة vi-generate، ولا تنفّذ أي أداة.
- لا تُضف كتلة vi-generate إلا إذا أعرب المستخدم عن رغبته في التوليد (مثل: ولّد لي، أنشئ صورة، اصنع فيديو...).
- إذا كان الطلب غامضًا، اسأل سؤالًا واحدًا توضيحيًا قبل صياغة الوصف.
- لا تختلق معلومات عن ميزات غير موجودة في الاستوديو.`;

export function resolveChatProvider(
  userKey?: string | null
): ChatProviderConfig | null {
  const trimmedUserKey = userKey?.trim();

  // 1) مفتاح OpenAI الخاص بالمستخدم من المتصفح
  if (trimmedUserKey) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: trimmedUserKey,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      label: "OpenAI — مفتاحك الخاص",
    };
  }

  // 2) مفتاح OpenAI على الخادم
  if (process.env.OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      label: "OpenAI",
    };
  }

  // 3) نماذج المحادثة لدى kie.ai (الافتراضي — يعمل بنفس المفتاح الموجود)
  // kimi-k3-1-pro: نموذج نصي خالص يلتزم بتعليمات كتلة vi-generate بدقة
  const kieModel = process.env.KIE_CHAT_MODEL ?? "kimi-k3-1-pro";
  if (process.env.KIE_API_KEY) {
    return {
      url: `https://api.kie.ai/${kieModel}/v1/chat/completions`,
      apiKey: process.env.KIE_API_KEY,
      model: null,
      label: `kie.ai — ${kieModel}`,
    };
  }

  return null;
}

/** إرسال المحادثة إلى المزوّد وإرجاع رد المساعد */
export async function chatComplete(
  config: ChatProviderConfig,
  messages: ChatMessage[]
): Promise<string> {
  const body: Record<string, unknown> = { messages };
  if (config.model) {
    body.model = config.model;
  }

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | {
        choices?: { message?: { content?: unknown } }[];
        error?: { message?: string };
        msg?: string;
      }
    | null;

  const content = json?.choices?.[0]?.message?.content;
  if (!res.ok || typeof content !== "string") {
    const msg =
      json?.error?.message ??
      json?.msg ??
      (typeof content !== "string" && json ? "صيغة رد غير متوقعة" : null) ??
      `HTTP ${res.status}`;
    throw new Error(`تعذر الحصول على رد المساعد: ${msg}`);
  }
  return content;
}
