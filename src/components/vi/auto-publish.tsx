"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import {
  Check,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Settings2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Generation } from "@/lib/types";

/**
 * تبويب «النشر التلقائي»: تحكم كامل في نظام النشر —
 * تشغيل الأوتوبايلوت يدويًا، إعداد التوكن، وإدارة المعرض العام
 * (المنشورات تظهر للجميع على /gallery).
 */
export function AutoPublish() {
  const { toast } = useToast();

  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [published, setPublished] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);

  const [token, setToken] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadPublished = useCallback(async () => {
    try {
      const res = await fetch("/api/published", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: Generation[] };
        setPublished(data.items ?? []);
      }
    } catch {
      /* عابر */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setToken(localStorage.getItem("vi_autopilot_token") ?? "");
    loadPublished();
  }, [loadPublished]);

  async function runAutopilot(onlyPublish: boolean) {
    if (running) return;
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/autopilot/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token.trim() ? { "x-autopilot-token": token.trim() } : {}),
        },
        body: JSON.stringify(
          onlyPublish
            ? { create: false }
            : { type: "video" }
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        publishedIds?: string[];
        created?: { id: string; type: string } | null;
        note?: string | null;
        summary?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "تعذر تشغيل الأوتوبايلوت");
      }
      setLastResult(
        data.summary +
          (data.note ? ` — ${data.note}` : "") +
          (data.created ? ` (مهمة جديدة: ${data.created.id.slice(0, 8)}…)` : "")
      );
      toast({
        title:
          data.publishedIds && data.publishedIds.length > 0
            ? `نُشر ${data.publishedIds.length} عمل في المعرض ✅`
            : "تم تنفيذ خطوة الأوتوبايلوت",
        description: data.note ?? undefined,
      });
      loadPublished();
    } catch (err) {
      toast({
        title: "خطأ في الأوتوبايلوت",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  async function togglePublish(item: Generation) {
    try {
      const res = await fetch(`/api/generations/${item.id}/publish`, {
        method: item.published ? "DELETE" : "PUT",
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: Generation;
        error?: string;
      };
      if (!res.ok || !data.item) {
        throw new Error(data.error ?? "تعذر تغيير حالة النشر");
      }
      setPublished((prev) =>
        item.published
          ? prev.filter((x) => x.id !== item.id)
          : [data.item!, ...prev]
      );
      toast({
        title: item.published ? "تم إلغاء النشر من المعرض" : "تم النشر في المعرض ✅",
      });
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    }
  }

  function saveToken() {
    const trimmed = keyDraft.trim();
    setToken(trimmed);
    localStorage.setItem("vi_autopilot_token", trimmed);
    setSettingsOpen(false);
    toast({
      title: trimmed ? "تم حفظ توكن الأوتوبايلوت" : "تمت إزالة التوكن",
      description: trimmed
        ? "سيُرسل مع كل تشغيل من هذا المتصفح فقط."
        : "سيعمل الزر مباشرة إذا كان الخادم بدون توكن.",
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* بطاقة الأوتوبايلوت */}
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Rocket className="h-5 w-5 text-fuchsia-400" />
            النشر التلقائي (أوتوبايلوت)
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            يعمل الموقع من تلقاء نفسه: كل تشغيل ينشر الأعمال المكتملة في
            المعرض العام{" "}
            <a href="/gallery" target="_blank" rel="noreferrer" className="text-fuchsia-300 underline">
              /gallery
            </a>{" "}
            ثم ينشئ فيديو عموديًا جديدًا بنمط السوشيال ميديا من قائمة مواضيع
            تدور تلقائيًا — وعند اكتمال الفيديو يُنشر وحده في الزيارة التالية
            دون أي تدخل منك. بعد نشر Vercel سيعمل هذا كل يوم تلقائيًا
            (Vercel Cron)، ويمكن لشات جي بي تي أيضًا تشغيله بأمر واحد عبر
            الـ Action المسمى runAutopilot.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => runAutopilot(false)}
              disabled={running}
              className="gap-1.5 bg-gradient-to-l from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-500 hover:to-purple-500"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              شغّل الأوتوبايلوت الآن (فيديو جديد)
            </Button>
            <Button
              variant="secondary"
              onClick={() => runAutopilot(true)}
              disabled={running}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              انشر المكتمل فقط
            </Button>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto gap-1.5 text-muted-foreground"
                  aria-label="إعدادات توكن الأوتوبايلوت"
                >
                  <Settings2 className="h-4 w-4" />
                  توكن الحماية
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>توكن حماية الأوتوبايلوت</DialogTitle>
                  <DialogDescription>
                    إذا ضبطت AUTOPILOT_TOKEN أو CRON_SECRET على الخادم
                    (Vercel) أدخله هنا ليعمل الزر من متصفحك. إذا لم تضبط
                    شيئًا فالمسار مفتوح والزر يعمل مباشرة. التوكن يُحفظ في
                    متصفحك فقط.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="autopilot-token">التوكن</Label>
                  <Input
                    id="autopilot-token"
                    type="password"
                    dir="ltr"
                    placeholder="my-secret-token"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={saveToken}>حفظ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {lastResult && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300">
              <Check className="me-1 inline h-3.5 w-3.5" />
              {lastResult}
            </p>
          )}

          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs leading-6 text-muted-foreground sm:grid-cols-3">
            <p>🔁 <b className="text-foreground">يدويًا:</b> زر التشغيل أعلاه وقتما تشاء</p>
            <p>📅 <b className="text-foreground">مجدول:</b> كل يوم 9 صباحًا UTC على Vercel تلقائيًا</p>
            <p>💬 <b className="text-foreground">عبر ChatGPT:</b> «شغّل الأوتوبايلوت وانشر»</p>
          </div>
        </CardContent>
      </Card>

      {/* المعرض العام الحالي */}
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5 text-fuchsia-400" />
            المعرض العام الآن
            <Badge variant="outline" className="font-mono text-[10px]">
              {published.length}
            </Badge>
            <a
              href="/gallery"
              target="_blank"
              rel="noreferrer"
              className="ms-auto inline-flex items-center gap-1 text-xs font-bold text-fuchsia-300 underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              فتح المعرض
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid place-items-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-fuchsia-400" />
            </div>
          ) : published.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              لا شيء منشور بعد — شغّل الأوتوبايلوت أو انشر عملًا مكتملًا من
              السجل في تبويب الاستوديو.
            </p>
          ) : (
            <div className="grid max-h-[480px] grid-cols-2 gap-4 overflow-y-auto pe-1 sm:grid-cols-3">
              {published.map((item) => (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-border/70 bg-card"
                >
                  <div className="aspect-square bg-black/40" dir="ltr">
                    {item.type === "image" && item.resultUrls[0] ? (
                      <img
                        src={item.resultUrls[0]}
                        alt={item.prompt}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : item.resultUrls[0] ? (
                      <video
                        src={item.resultUrls[0]}
                        controls
                        loop
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    <p className="line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
                      {item.prompt}
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] text-muted-foreground">
                        {item.publishedAt
                          ? formatDistanceToNow(new Date(item.publishedAt), {
                              addSuffix: true,
                              locale: ar,
                            })
                          : ""}
                      </span>
                      <button
                        onClick={() => togglePublish(item)}
                        className="rounded-md border border-border/70 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground transition hover:border-red-500/50 hover:text-red-300"
                      >
                        إلغاء النشر
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
