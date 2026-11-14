"use client";

import { useSyncExternalStore } from "react";
import {
  Boxes,
  Clapperboard,
  ExternalLink,
  Image as ImageIcon,
  ListChecks,
  Plug,
  Rocket,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton, UrlRow } from "@/components/vi/copy-bits";

const useOrigin = () =>
  useSyncExternalStore(
    () => () => {}, // لا اشتراك — الدومين ثابت خلال عمر الصفحة
    () => window.location.origin,
    () => "" // قيمة الخادم (SSR)
  );

/** أدوات MCP المتاحة (تُعرض في الواجهة بالعربية) */
const TOOLS = [
  {
    icon: ImageIcon,
    name: "generate_image",
    desc: "توليد صورة جديدة (مع خيار انتظار النتيجة في نفس الطلب)",
  },
  {
    icon: Clapperboard,
    name: "generate_video",
    desc: "توليد فيديو جديد بمدة ودقة وأصوات اختيارية — مع دعم تحريك صور مرفوعة (image-to-video)",
  },
  {
    icon: Clapperboard,
    name: "continue_video",
    desc: "تكملة فيديو مكتمل كجزء جديد في سلسلة: من صور الجزء الجديد أو بتمديد تلقائي من النهاية",
  },
  {
    icon: ListChecks,
    name: "get_generation",
    desc: "متابعة حالة مهمة حتى الاكتمال وجلب روابط النتيجة",
  },
  {
    icon: Boxes,
    name: "list_generations",
    desc: "عرض سجل التوليد الكامل (الخاص)",
  },
  {
    icon: Boxes,
    name: "list_published",
    desc: "عرض الأعمال المنشورة حاليًا في المعرض العام",
  },
  {
    icon: Rocket,
    name: "publish_generation",
    desc: "نشر عمل مكتمل في المعرض العام أو إخفاؤه",
  },
  {
    icon: Trash2,
    name: "delete_generation",
    desc: "حذف أي عنصر من السجل",
  },
  {
    icon: Clapperboard,
    name: "merge_videos",
    desc: "دمج 2-8 فيديوهات مكتملة في مقطع واحد بالترتيب المطلوب عبر ffmpeg",
  },
  {
    icon: Rocket,
    name: "run_autopilot",
    desc: "تشغيل خطوة النشر التلقائي: نشر ما اكتمل وإنشاء فيديو جديد",
  },
];

export function McpGuide() {
  const origin = useOrigin();
  const base = origin ? `${origin}/mcp` : "https://YOUR-DOMAIN/mcp";

  // إعدادات جاهزة — تُنسخ بالدومين الحقيقي
  const simpleConfig = JSON.stringify(
    {
      mcpServers: {
        "vi-ai-studio": {
          url: base,
        },
      },
    },
    null,
    2
  );

  const secureConfig = JSON.stringify(
    {
      mcpServers: {
        "vi-ai-studio": {
          url: base,
          headers: {
            Authorization: "Bearer <MCP_API_KEY>",
          },
        },
      },
    },
    null,
    2
  );

  const remoteConfig = JSON.stringify(
    {
      mcpServers: {
        "vi-ai-studio": {
          command: "npx",
          args: ["-y", "mcp-remote", base],
        },
      },
    },
    null,
    2
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plug className="h-5 w-5 text-fuchsia-400" />
            تحكّم في التطبيق عبر MCP (Model Context Protocol)
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            MCP بروتوكول مفتوح من Anthropic يتيح لأي عميل ذكاء اصطناعي يدعمه —
            مثل Claude وCursor وWindsurf وCodex CLI وCherry Studio — التحكم
            الكامل في تطبيقك: توليد الصور والفيديو، متابعة الحالة، النشر في
            المعرض العام، الحذف، وتشغيل النشر التلقائي — دون أي تدخل يدوي منك.
            خلاف تبويب «ربط ChatGPT» (المخصص لـ Actions)، هذا معيار صناعي يعمل
            مع أي وكيل يدعم بروتوكول MCP.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* رابط الخادم */}
          <UrlRow
            label="① رابط خادم MCP (نوع النقل: Streamable HTTP)"
            path="/mcp"
            title="رابط خادم MCP"
          />

          {/* الأدوات المتاحة */}
          <div className="space-y-3">
            <p className="text-sm font-bold">الأدوات المتاحة ({TOOLS.length})</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TOOLS.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <tool.icon className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-400" />
                  <div className="min-w-0">
                    <code dir="ltr" className="text-xs font-bold text-fuchsia-300">
                      {tool.name}
                    </code>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {tool.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* إعدادات العملاء */}
          <div className="space-y-3">
            <p className="text-sm font-bold">إعدادات جاهزة للعملاء</p>

            <ConfigBlock
              title="② Claude Desktop / Cursor / Windsurf (أي عميل يدعم روابط MCP البعيدة)"
              text={simpleConfig}
            />
            <ConfigBlock
              title="③ مع حماية بمفتاح (إذا فعّلت MCP_API_KEY على الخادم)"
              text={secureConfig}
            />
            <ConfigBlock
              title="④ Claude Desktop عبر mcp-remote (للإصدارات التي لا تدعم الروابط البعيدة مباشرة)"
              text={remoteConfig}
            />
          </div>

          {/* ملاحظة الأمان */}
          <Alert className="border-amber-500/30 bg-amber-500/10">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            <AlertTitle>ملاحظة أمان مهمة</AlertTitle>
            <AlertDescription className="text-xs leading-6">
              بدون مفتاح، أي شخص يعرف رابط الموقع يستطيع استخدام أدوات التوليد
              (ويستهلك رصيد kie.ai الخاص بك). لتأمينه: أضف متغير البيئة
              <code dir="ltr" className="mx-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                MCP_API_KEY
              </code>
              في إعدادات Vercel ثم أعد النشر، وضع نفس المفتاح في إعدادات العميل
              كما في الإعداد ③. مسار الأوتوبايلوت له حماية مستقلة عبر
              <code dir="ltr" className="mx-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                AUTOPILOT_TOKEN
              </code>
              .
            </AlertDescription>
          </Alert>

          {/* روابط مساعدة */}
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-fuchsia-300 underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              توثيق بروتوكول MCP الرسمي
            </a>
            <a
              href="https://support.anthropic.com/en/articles/10065433"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-fuchsia-300 underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              ربط الخوادم البعيدة في Claude
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-fuchsia-300">{title}</p>
        <CopyButton text={text} label="الإعدادات" />
      </div>
      <pre
        dir="ltr"
        className="max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-muted/30 p-4 text-xs leading-6 text-muted-foreground"
      >
        {text}
      </pre>
    </div>
  );
}
