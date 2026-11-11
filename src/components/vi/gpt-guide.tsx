"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, KeyRound, ListOrdered } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/** نص التعليمات الجاهز للصق في خانة Instructions عند إنشاء الـ Custom GPT */
const GPT_INSTRUCTIONS = `أنت "مساعد Vi" — تتحكم بالكامل في تطبيق Vi AI Studio الخاص بالمستخدم (توليد ونشر الصور والفيديو بالذكاء الاصطناعي) عبر الـ Actions المتاحة لك.

خطوات عملك عندما يطلب المستخدم توليد صورة أو فيديو:
1. حوّل طلب المستخدم إلى وصف إنجليزي غني بالتفاصيل البصرية (الموضوع، الأسلوب، الإضاءة، زاوية الكاميرا، الجو العام) — الوصف الإنجليزي يعطي أفضل النتائج.
2. استدعِ createGeneration:
   - للصورة: type="image" والافتراضي aspectRatio="1:1" وresolution="1K".
   - للفيديو: type="video" والافتراضي aspectRatio="16:9" وresolution="720p" وduration=8 وenableAudio=true.
   - اسأل المستخدم عن الأبعاد والدقة فقط إذا ذكرها صراحة أو كان الطلب يحتاجها (مثل: صورة ستوري عمودية → 9:16).
3. استدعِ getGeneration بمعرّف id الذي حصلت عليه مع wait=8، وكرر الاستدعاء حتى تصبح الحالة success أو fail (الصورة تستغرق عادة 20-60 ثانية، والفيديو أطول).
4. عند النجاح: انشر العمل فورًا باستدعاء publishGeneration ليظهر في المعرض العام على الموقع (مسار /gallery)، ثم اعرض رابط أو روابط النتيجة من resultUrls للمستخدم واذكر أن العمل نُشر على موقعه.
5. عند الفشل: اشرح سبب الفشل من حقل error باختصار، واقترح تعديل الوصف ثم أعد المحاولة.

النشر التلقائي (بدون تدخل المستخدم):
- إذا طلب المستخدم نشر فيديوهات أو أعمال جديدة تلقائيًا (مثل: «انشر فيديوهات جديدة على الموقع» أو «شغّل الأوتوبايلوت») استدعِ runAutopilot — سيبدأ بنشر الأعمال المكتملة ثم ينشئ فيديو عموديًا جديدًا من قائمة مواضيع تدور تلقائيًا، ويُنشر وحده عند اكتماله في الزيارة التالية.
- راقب المهمة الجديدة بـ getGeneration مع wait=8 حتى الاكتمال، ثم انشرها بـ publishGeneration.
- لعرض ما هو منشور حاليًا على الموقع استخدم listPublishedWorks، ولإخفاء عمل منشور استخدم unpublishGeneration بعد تأكيد المستخدم.

مبادئ ثابتة:
- تحدث مع المستخدم بالعربية دائمًا وبتعامل ودود ومختصر.
- ارفض إنشاء محتوى غير لائق أو ضار أو ينتهك حقوق الآخرين.
- لا تختلق روابط نتائج؛ اعرض فقط ما يعيده الـ Action فعليًا.`;

const STEPS = [
  {
    title: "انشر التطبيق على Vercel",
    body: "شات جي بي تي يحتاج رابطًا عامًا يصل إليه — لا يعمل مع localhost. ارفع المشروع (مرفوع أصلًا على GitHub) واستورده في Vercel، ثم انسخ رابط التطبيق النهائي مثل https://vi-xxx.vercel.app",
  },
  {
    title: "افتح منشئ الـ GPT في ChatGPT",
    body: "من chatgpt.com: القائمة الجانبية → استكشاف GPTs → إنشاء (يتطلب خطة Plus). انتقل إلى تبويب Configure لإعداد متقدم.",
  },
  {
    title: "أضف الـ Action واستورد المخطط",
    body: "Actions → Create new action → Authentication: None → استخدم Import from URL والصق رابط المخطط أدناه. سيقرأ ChatGPT العمليات الأربع تلقائيًا (إنشاء / متابعة / سجل / حذف).",
  },
  {
    title: "أضف رابط سياسة الخصوصية",
    body: "في إعدادات الـ GPT (خانة Privacy Policy URL) ضع رابط صفحة الخصوصية الجاهزة في تطبيقك — مطلوب لإنشاء الـ GPT مع Actions.",
  },
  {
    title: "الصق التعليمات واحفظ",
    body: "انسخ نص التعليمات أدناه والصقه في خانة Instructions، ثم اضغط Save (Visible to me فقط يكفي).",
  },
  {
    title: "جرّب التحكم!",
    body: "افتح الـ GPT الجديد واكتب مثلًا: «ولّد لي صورة قطة فضائية يشرب قهوة» — سينشئ المهمة في تطبيقك، يتابعها، ويعيد لك الرابط. النتيجة ستظهر أيضًا في سجل الاستوديو هنا.",
  },
];

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: `تم نسخ ${label}` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "تعذر النسخ — انسخه يدويًا", variant: "destructive" });
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={copy} className="gap-1.5">
      {copied ? (
        <Check className="h-4 w-4 text-emerald-400" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      نسخ
    </Button>
  );
}

const useOrigin = () =>
  useSyncExternalStore(
    () => () => {}, // لا اشتراك — الدومين ثابت خلال عمر الصفحة
    () => window.location.origin,
    () => "" // قيمة الخادم (SSR)
  );

export function UrlRow({ label, path, title }: { label: string; path: string; title: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  // الدومين الحالي (يعمل على localhost وعلى Vercel تلقائيًا)
  const origin = useOrigin();
  const full = origin ? `${origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      toast({ title: `تم نسخ ${title}` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "تعذر النسخ — انسخه يدويًا", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-fuchsia-300">{label}</p>
      <div
        dir="ltr"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
      >
        <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {full}
        </code>
        <Button size="sm" variant="secondary" onClick={copy} className="gap-1.5">
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          نسخ
        </Button>
      </div>
    </div>
  );
}

export function GptGuide() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-fuchsia-400" />
            تحكّم في تطبيقك من شات جي بي تي
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            التطبيق جاهز الآن للعمل كـ Custom GPT: بمجرد استيراد مخطط
            OpenAPI في ChatGPT يستطيع شات جي بي تي توليد الصور والفيديو
            عبر تطبيقك، متابعة الحالة، عرض السجل، والحذف — كل ذلك من داخل
            المحادثة، والنتائج تُحفظ في نفس قاعدة البيانات.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* الروابط الجاهزة */}
          <div className="grid gap-4 sm:grid-cols-2">
            <UrlRow
              label="① رابط مخطط الـ Actions (Import from URL)"
              path="/api/openapi.json"
              title="رابط المخطط"
            />
            <UrlRow
              label="② رابط سياسة الخصوصية (Privacy Policy URL)"
              path="/privacy"
              title="رابط الخصوصية"
            />
          </div>

          {/* الخطوات */}
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <ListOrdered className="h-4 w-4 text-fuchsia-400" />
              خطوات الربط (5 دقائق)
            </p>
            <ol className="space-y-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className="flex gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-700 text-xs font-black text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{step.title}</p>
                    <p className="mt-0.5 text-xs leading-6 text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* نص التعليمات */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">
                نص تعليمات الـ GPT (خانة Instructions)
              </p>
              <CopyButton text={GPT_INSTRUCTIONS} label="نص التعليمات" />
            </div>
            <pre
              dir="rtl"
              className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/30 p-4 text-xs leading-6 text-muted-foreground"
            >
              {GPT_INSTRUCTIONS}
            </pre>
          </div>

          {/* روابط مساعدة */}
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              href="https://help.openai.com/en/articles/8554397-creating-a-gpt"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-fuchsia-300 underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              دليل OpenAI لإنشاء Custom GPT
            </a>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-fuchsia-300 underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              معاينة المخطط
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
