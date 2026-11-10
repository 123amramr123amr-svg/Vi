"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import {
  AlertTriangle,
  Clapperboard,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  isActiveStatus,
  type Generation,
  type GenerationType,
  type GenerationStatus,
} from "@/lib/types";

const IMAGE_MODEL_LABEL = "gpt-image-2-6/flare-text-to-image";
const VIDEO_MODEL_LABEL = "grok-imagine-video-1-5-preview";

const STATUS_LABEL: Record<GenerationStatus, string> = {
  pending: "جارٍ الإرسال",
  waiting: "في قائمة الانتظار",
  queuing: "في الطابور",
  generating: "جارٍ التوليد",
  success: "اكتمل",
  fail: "فشل",
};

export function Studio() {
  const { toast } = useToast();

  const [type, setType] = useState<GenerationType>("image");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("auto");
  const [resolution, setResolution] = useState<string>("1K");
  const [duration, setDuration] = useState(8);
  const [enableAudio, setEnableAudio] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const maxPrompt = type === "image" ? 20000 : 4096;
  const aspectOptions = type === "image" ? IMAGE_ASPECT_RATIOS : VIDEO_ASPECT_RATIOS;
  const resolutionOptions = type === "image" ? IMAGE_RESOLUTIONS : VIDEO_RESOLUTIONS;
  const placeholder =
    type === "image"
      ? "مثال: قط فضائي يرتدي بدلة رائد فضاء، إضاءة سينمائية، تفاصيل عالية الدقة…"
      : "مثال: كاميرا تتحرك ببطء فوق شوارع مدينة مستقبلية ليلًا، حركة سلسة وإضاءة نيون…";

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/generations", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: Generation[] };
        setHistory(data.items ?? []);
      }
    } catch {
      /* تجاهل — السجل غير حرج */
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/generations/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { item?: Generation };
        if (!data.item) return;
        setCurrent(data.item);
        if (!isActiveStatus(data.item.status)) {
          stopPolling();
          loadHistory();
          if (data.item.status === "success") {
            toast({ title: "اكتمل التوليد 🎉", description: "النتيجة جاهزة للعرض والتحميل." });
          } else if (data.item.status === "fail") {
            toast({
              title: "فشل التوليد",
              description: data.item.error ?? "حاول مرة أخرى.",
              variant: "destructive",
            });
          }
        }
      } catch {
        /* خطأ عابر — سيتكرر الاستعلام */
      }
    },
    [stopPolling, loadHistory, toast]
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      startedAtRef.current = Date.now();
      setElapsed(0);
      pollRef.current = setInterval(() => pollOnce(id), 4000);
    },
    [pollOnce, stopPolling]
  );

  useEffect(() => {
    loadHistory();
    return () => stopPolling();
  }, [loadHistory, stopPolling]);

  const currentId = current?.id;
  const currentStatus = current?.status;
  useEffect(() => {
    if (!currentId || !currentStatus || !isActiveStatus(currentStatus)) return;
    const tick = () =>
      setElapsed(Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [currentId, currentStatus]);

  function handleTypeChange(value: string) {
    if (!value || value === type) return;
    const next = value as GenerationType;
    setType(next);
    setAspect("auto");
    setResolution(next === "image" ? "1K" : "720p");
  }

  async function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const payload =
        type === "image"
          ? { type, prompt: trimmed, aspectRatio: aspect, resolution }
          : { type, prompt: trimmed, aspectRatio: aspect, resolution, duration, enableAudio };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        taskId?: string;
        error?: string;
      };
      if (!res.ok || !data.id) {
        throw new Error(data.error ?? "تعذر إنشاء مهمة التوليد");
      }

      setCurrent({
        id: data.id,
        taskId: data.taskId ?? null,
        type,
        model: type === "image" ? IMAGE_MODEL_LABEL : VIDEO_MODEL_LABEL,
        prompt: trimmed,
        params:
          type === "image"
            ? { aspectRatio: aspect, resolution }
            : { aspectRatio: aspect, resolution, duration, enableAudio },
        status: "waiting",
        resultUrls: [],
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      startPolling(data.id);
      loadHistory();
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function openItem(item: Generation) {
    setCurrent(item);
    if (isActiveStatus(item.status)) {
      startPolling(item.id);
    } else {
      stopPolling();
    }
  }

  async function deleteItem(id: string) {
    setHistory((prev) => prev.filter((x) => x.id !== id));
    if (currentId === id) setCurrent(null);
    try {
      await fetch(`/api/generations/${id}`, { method: "DELETE" });
      toast({ title: "تم الحذف من السجل" });
    } catch {
      toast({ title: "تعذر الحذف", variant: "destructive" });
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "تم نسخ الرابط" });
    } catch {
      toast({ title: "تعذر نسخ الرابط", variant: "destructive" });
    }
  }

  const currentActive = current ? isActiveStatus(current.status) : false;

  return (
    <div className="flex min-h-screen flex-col">
      {/* الترويسة */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-lg font-black text-white shadow-lg shadow-fuchsia-500/25">
              V
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-none">Vi</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                استوديو التوليد بالذكاء الاصطناعي
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="gap-1.5 border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300"
          >
            <Sparkles className="h-3.5 w-3.5" />
            مدعوم بـ kie.ai
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:py-10">
        <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* لوحة الإنشاء */}
          <Card className="border-border/70 shadow-xl shadow-black/10 lg:sticky lg:top-24">
            <CardContent className="space-y-5 p-5">
              <ToggleGroup
                type="single"
                value={type}
                onValueChange={handleTypeChange}
                className="grid w-full grid-cols-2 gap-2"
              >
                <ToggleGroupItem
                  value="image"
                  aria-label="توليد صورة"
                  className="h-11 gap-2 rounded-xl border border-border data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  <ImageIcon className="h-4 w-4" /> صورة
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="video"
                  aria-label="توليد فيديو"
                  className="h-11 gap-2 rounded-xl border border-border data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  <Video className="h-4 w-4" /> فيديو
                </ToggleGroupItem>
              </ToggleGroup>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="prompt">وصف المحتوى</Label>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {prompt.length} / {maxPrompt}
                  </span>
                </div>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, maxPrompt))}
                  placeholder={placeholder}
                  rows={5}
                  className="resize-none bg-input/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>نسبة الأبعاد</Label>
                  <Select value={aspect} onValueChange={setAspect}>
                    <SelectTrigger className="w-full" dir="ltr">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectOptions.map((r) => (
                        <SelectItem key={r} value={r} dir="ltr">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>الدقة</Label>
                  <Select value={resolution} onValueChange={setResolution}>
                    <SelectTrigger className="w-full" dir="ltr">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resolutionOptions.map((r) => (
                        <SelectItem key={r} value={r} dir="ltr">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {type === "video" && (
                <div className="space-y-4 rounded-xl border border-border/70 bg-muted/30 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>مدة الفيديو</Label>
                      <span className="text-sm font-bold text-fuchsia-300">
                        {duration} ثانية
                      </span>
                    </div>
                    <Slider
                      value={[duration]}
                      min={1}
                      max={15}
                      step={1}
                      onValueChange={(v) => setDuration(v[0] ?? 8)}
                      aria-label="مدة الفيديو بالثواني"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label>الصوت التلقائي</Label>
                      <p className="text-xs text-muted-foreground">
                        توليد صوت مرافق للفيديو
                      </p>
                    </div>
                    <Switch
                      checked={enableAudio}
                      onCheckedChange={setEnableAudio}
                      aria-label="تشغيل الصوت التلقائي"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={submit}
                disabled={submitting || !prompt.trim()}
                className="h-12 w-full bg-gradient-to-l from-fuchsia-600 to-purple-600 text-base font-extrabold text-white shadow-lg shadow-fuchsia-600/30 hover:from-fuchsia-500 hover:to-purple-500"
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
                {submitting ? "جارٍ الإرسال…" : "توليد الآن"}
              </Button>

              <p className="text-center text-[11px] leading-5 text-muted-foreground">
                النموذج المستخدم:{" "}
                <span className="font-mono" dir="ltr">
                  {type === "image" ? IMAGE_MODEL_LABEL : VIDEO_MODEL_LABEL}
                </span>
              </p>
            </CardContent>
          </Card>

          {/* منطقة النتيجة والسجل */}
          <div className="space-y-8">
            <Card className="border-border/70 shadow-xl shadow-black/10">
              <CardContent className="p-5">
                {!current ? (
                  <div className="grid place-items-center py-16 text-center">
                    <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-purple-600/20">
                      <Sparkles className="h-8 w-8 text-fuchsia-300" />
                    </div>
                    <h3 className="text-lg font-bold">ابدأ الإبداع</h3>
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                      اكتب وصفًا في اللوحة الجانبية واختر بين توليد صورة أو فيديو،
                      وستظهر النتيجة هنا مباشرة.
                    </p>
                  </div>
                ) : current.status === "success" ? (
                  <MediaResult item={current} onCopy={copyUrl} />
                ) : current.status === "fail" ? (
                  <div className="space-y-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>فشل التوليد</AlertTitle>
                      <AlertDescription>
                        {current.error ?? "حدث خطأ غير معروف — حاول مرة أخرى."}
                      </AlertDescription>
                    </Alert>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {current.prompt}
                    </p>
                  </div>
                ) : (
                  <div className="grid place-items-center gap-4 py-14 text-center">
                    <Loader2 className="h-12 w-12 animate-spin text-fuchsia-400" />
                    <div>
                      <p className="font-bold">
                        {STATUS_LABEL[current.status] ?? current.status}…
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        منقضٍ {elapsed} ثانية — قد يستغرق توليد الفيديو عدة دقائق
                      </p>
                    </div>
                    <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-l from-fuchsia-500 to-purple-500" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* السجل */}
            <section aria-label="آخر الأعمال">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-extrabold">
                  <Clapperboard className="h-5 w-5 text-fuchsia-400" />
                  آخر الأعمال
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadHistory}
                  className="gap-1.5 text-muted-foreground"
                >
                  <RefreshCw className="h-4 w-4" /> تحديث
                </Button>
              </div>

              {loadingHistory ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square animate-pulse rounded-xl bg-muted/50"
                    />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
                  لا توجد أعمال بعد — أنشئ أول عمل من اللوحة الجانبية.
                </div>
              ) : (
                <div className="grid max-h-[640px] grid-cols-2 gap-4 overflow-y-auto pe-1 sm:grid-cols-3 lg:grid-cols-4">
                  {history.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      onOpen={openItem}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row">
          <p>Vi — استوديو توليد الصور والفيديو بالذكاء الاصطناعي</p>
          <p dir="ltr" className="font-mono">
            Next.js · Turso · kie.ai
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ---------- مكوّنات مساعدة ---------- */

function MediaResult({
  item,
  onCopy,
}: {
  item: Generation;
  onCopy: (url: string) => void;
}) {
  const url = item.resultUrls[0];
  if (!url) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        اكتمل التوليد لكن المزوّد لم يُرجع رابط نتيجة.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div
        dir="ltr"
        className="overflow-hidden rounded-xl border border-border/70 bg-black/40 shadow-2xl shadow-black/30"
      >
        {item.type === "image" ? (
          <img
            src={url}
            alt={item.prompt}
            className="w-full"
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-[70vh] w-full"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href={url} download target="_blank" rel="noreferrer">
          <Button size="sm" className="gap-1.5">
            <Download className="h-4 w-4" /> تحميل
          </Button>
        </a>
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5"
          onClick={() => onCopy(url)}
        >
          <Copy className="h-4 w-4" /> نسخ الرابط
        </Button>
        <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">
          {item.model}
        </Badge>
      </div>

      <div className="rounded-xl border border-border/50 bg-muted/40 p-3">
        <p className="mb-1 text-xs font-bold text-muted-foreground">الوصف:</p>
        <p className="text-sm leading-6">{item.prompt}</p>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: GenerationType }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-white/20 bg-black/45 text-[10px] text-white backdrop-blur-sm"
    >
      {type === "image" ? (
        <>
          <ImageIcon className="h-3 w-3" /> صورة
        </>
      ) : (
        <>
          <Video className="h-3 w-3" /> فيديو
        </>
      )}
    </Badge>
  );
}

function StatusBadge({ status }: { status: GenerationStatus }) {
  if (status === "success") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-300"
      >
        اكتمل
      </Badge>
    );
  }
  if (status === "fail") {
    return (
      <Badge
        variant="outline"
        className="border-red-500/30 bg-red-500/15 text-[10px] text-red-300"
      >
        فشل
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-fuchsia-500/30 bg-fuchsia-500/15 text-[10px] text-fuchsia-300"
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function HistoryCard({
  item,
  onOpen,
  onDelete,
}: {
  item: Generation;
  onOpen: (g: Generation) => void;
  onDelete: (id: string) => void;
}) {
  const active = isActiveStatus(item.status);
  const firstUrl = item.resultUrls[0] ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(item);
      }}
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card transition hover:border-fuchsia-500/50 hover:shadow-lg hover:shadow-fuchsia-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-muted/40">
        {item.status === "success" && firstUrl && item.type === "image" ? (
          <img
            src={firstUrl}
            alt={item.prompt}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className={`grid h-full w-full place-items-center bg-gradient-to-br ${
              item.type === "video"
                ? "from-purple-900/50 to-fuchsia-900/50"
                : "from-violet-900/40 to-purple-900/40"
            }`}
          >
            {active ? (
              <Loader2 className="h-7 w-7 animate-spin text-fuchsia-300" />
            ) : item.status === "fail" ? (
              <AlertTriangle className="h-7 w-7 text-red-300" />
            ) : item.type === "video" ? (
              <Video className="h-7 w-7 text-fuchsia-300" />
            ) : (
              <ImageIcon className="h-7 w-7 text-violet-300" />
            )}
          </div>
        )}
        <div className="absolute start-2 top-2">
          <TypeBadge type={item.type} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          aria-label="حذف من السجل"
          className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-black/50 text-white/80 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-red-600 hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 min-h-10 text-xs font-medium leading-5">
          {item.prompt}
        </p>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(item.createdAt), {
              addSuffix: true,
              locale: ar,
            })}
          </span>
          <StatusBadge status={item.status} />
        </div>
      </div>
    </div>
  );
}
