"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { KIE_MODEL_CATALOG } from "@/lib/model-catalog";

/** شكل الإعدادات العام القادم من الخادم (بدون المفتاح الكامل) */
interface PublicSettings {
  baseUrl: string;
  apiKeyMasked: string | null;
  apiKeySource: "custom" | "env" | "none";
  hasCustomKey: boolean;
  imageModel: string;
  videoModel: string;
  imageModelCustom: boolean;
  videoModelCustom: boolean;
  envImageModel: string;
  envVideoModel: string;
}

interface ModelOption {
  id: string;
  label?: string;
}

/** كلمات دلالية لترتيب النماذج المناسبة لكل نوع في أعلى القائمة */
const VIDEO_HINT =
  /video|imagine|veo|kling|seedance|hailuo|wan|luma|ray|ltx|pixverse|sora|runway|motion|animate|dream|pika|hunyuan/i;
const IMAGE_HINT =
  /image|flux|dall|imagen|banana|sd[3x]|stable|diffusion|midjourney|recraft|ideogram|gpt-image|qwen-image|nano|photon|grok-image/i;

function rankModels(models: ModelOption[], kind: "image" | "video"): ModelOption[] {
  const hint = kind === "image" ? IMAGE_HINT : VIDEO_HINT;
  const anti = kind === "image" ? VIDEO_HINT : IMAGE_HINT;
  return [...models].sort((a, b) => {
    const ah = hint.test(a.id) ? 0 : anti.test(a.id) ? 2 : 1;
    const bh = hint.test(b.id) ? 0 : anti.test(b.id) ? 2 : 1;
    if (ah !== bh) return ah - bh;
    return a.id.localeCompare(b.id);
  });
}

/** منتقي نموذج: بحث داخل القائمة + إدخال معرّف يدوي */
function ModelPicker({
  icon,
  title,
  models,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [customMode, setCustomMode] = useState(
    models.length === 0 || !models.some((m) => m.id === value)
  );

  const filtered = useMemo(() => {
    const ranked = rankModels(models, title.includes("الصور") ? "image" : "video");
    const q = filter.trim().toLowerCase();
    const list = q ? ranked.filter((m) => m.id.toLowerCase().includes(q)) : ranked;
    return list.slice(0, 120);
  }, [models, filter, title]);

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <Label className="text-sm font-bold">{title}</Label>
        <Badge
          variant="outline"
          dir="ltr"
          className="max-w-full truncate font-mono text-[10px] text-fuchsia-300"
        >
          {value || "لم يُختر"}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={customMode ? "secondary" : "ghost"}
          className="gap-1 text-xs"
          onClick={() => setCustomMode(true)}
        >
          <PenLine className="h-3.5 w-3.5" />
          كتابة معرّف يدويًا
        </Button>
        {models.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant={!customMode ? "secondary" : "ghost"}
            className="gap-1 text-xs"
            onClick={() => setCustomMode(false)}
          >
            <Search className="h-3.5 w-3.5" />
            اختيار من القائمة ({models.length})
          </Button>
        )}
      </div>

      {customMode ? (
        <Input
          dir="ltr"
          placeholder="model-id — مثل: grok-imagine-video-1-5-preview"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          aria-label={`معرّف ${title}`}
        />
      ) : (
        <>
          <Input
            dir="ltr"
            placeholder="ابحث في القائمة…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 text-xs"
            aria-label={`بحث في ${title}`}
          />
          <div
            className="max-h-44 space-y-1 overflow-y-auto pe-1"
            role="listbox"
            aria-label={title}
          >
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.id === value}
                onClick={() => onChange(m.id)}
                dir="ltr"
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-start font-mono text-xs transition ${
                  m.id === value
                    ? "border-fuchsia-500/70 bg-fuchsia-500/15 text-fuchsia-200"
                    : "border-border/60 bg-card text-muted-foreground hover:border-fuchsia-500/40 hover:text-foreground"
                }`}
              >
                <span className="flex-1 truncate">{m.id}</span>
                {m.id === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                {m.label && (
                  <span
                    dir="rtl"
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-sans text-[9px] text-muted-foreground"
                  >
                    افتراضي
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">
                لا نتائج مطابقة — جرّب كتابة معرّف يدويًا
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * تبويب «الإعدادات»: تغيير رابط خدمة التوليد ومفتاح API والنماذج —
 * أدخل الرابط والمفتاح ثم اضغط «جلب النماذج» فتظهر قائمة النماذج
 * المرتبطة بالمفتاح، اختر منها نموذج الصور ونموذج الفيديو واحفظ.
 */
export function SettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const { toast } = useToast();

  const [status, setStatus] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const [fetching, setFetching] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [fetchSource, setFetchSource] = useState<"provider" | "catalog" | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");

  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        settings?: PublicSettings;
        error?: string;
      };
      if (res.ok && data.settings) {
        const s = data.settings;
        setStatus(s);
        setBaseUrlDraft((prev) => prev || s.baseUrl);
        setImageModel((prev) => prev || s.imageModel);
        setVideoModel((prev) => prev || s.videoModel);
      } else {
        toast({
          title: "تعذر تحميل الإعدادات",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch {
      /* عابر */
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  /** جلب قائمة النماذج المرتبطة بالرابط والمفتاح من المزوّد */
  async function fetchModels() {
    if (fetching) return;
    setFetching(true);
    setFetchError(null);
    setFetchNote(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(baseUrlDraft.trim() ? { baseUrl: baseUrlDraft.trim() } : {}),
          ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        models?: string[];
        source?: "provider" | "catalog";
        note?: string;
        error?: string;
        attempts?: Array<{ endpoint: string; error: string }>;
      };
      if (!res.ok) throw new Error(data.error ?? "تعذر جلب النماذج");

      if (data.source === "provider" && data.models && data.models.length > 0) {
        setModels(data.models.map((id) => ({ id })));
        setFetchSource("provider");
        setFetchNote(
          `ظهرت ${data.models.length} نموذجًا مرتبطًا بالمفتاح — اختر منها نموذج الصور ونموذج الفيديو ثم احفظ`
        );
        toast({ title: `تم جلب ${data.models.length} نموذجًا` });
      } else {
        // كتالوج احتياطي (معرّفات معروفة مؤكدة) + إدخال يدوي
        setModels(
          KIE_MODEL_CATALOG.map((c) => ({
            id: c.id,
            label: c.id === KIE_MODEL_CATALOG[0].id ? undefined : c.label,
          }))
        );
        setFetchSource("catalog");
        const firstErr = data.attempts?.[0]?.error;
        setFetchNote(
          data.note ??
            "لم يدعم المزوّد جلب القائمة تلقائيًا — اختر من القائمة المعروفة أو اكتب المعرّف يدويًا"
        );
        setFetchError(
          firstErr && firstErr.toLowerCase().includes("unauthorized")
            ? "رفض المزوّد الطلب (Unauthorized) — تأكد أن المفتاح صحيح ومرتبط بحساب فعّال"
            : null
        );
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "تعذر جلب النماذج");
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    if (saving) return;
    if (!imageModel.trim() || !videoModel.trim()) {
      toast({
        title: "حدّد نموذج الصور ونموذج الفيديو أولًا",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrlDraft.trim(),
          ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
          imageModel: imageModel.trim(),
          videoModel: videoModel.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: PublicSettings;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "تعذر الحفظ");

      setStatus(data.settings ?? null);
      setApiKeyDraft("");
      setModels(null);
      setFetchSource(null);
      setFetchNote(null);
      setFetchError(null);
      toast({
        title: "حُفظت الإعدادات ✅",
        description:
          "تُطبَّق فورًا على كل مهمة جديدة: الاستوديو، المحادثة، ChatGPT، MCP، والأوتوبايلوت",
      });
      onSaved?.();
    } catch (err) {
      toast({
        title: "خطأ في الحفظ",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    try {
      const res = await fetch("/api/settings", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: PublicSettings;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "تعذر الاستعادة");
      const s = data.settings!;
      setStatus(s);
      setBaseUrlDraft(s.baseUrl);
      setImageModel(s.imageModel);
      setVideoModel(s.videoModel);
      setApiKeyDraft("");
      setModels(null);
      setFetchSource(null);
      setFetchNote(null);
      setFetchError(null);
      toast({
        title: "استُعيدت الإعدادات الافتراضية",
        description: "رجع الرابط والمفتاح والنماذج إلى قيم متغيرات البيئة",
      });
      onSaved?.();
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    }
  }

  async function removeCustomKey() {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearApiKey: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: PublicSettings;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "تعذر الإزالة");
      setStatus(data.settings ?? null);
      setApiKeyDraft("");
      toast({
        title: "أُزيل المفتاح المحفوظ",
        description: "سيعود الخادم إلى مفتاح متغيرات البيئة KIE_API_KEY",
      });
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* بطاقة المزوّد الحالي */}
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-fuchsia-400" />
            المزوّد والنماذج الحالية
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Badge
                variant="outline"
                className={
                  status?.hasCustomKey
                    ? "border-fuchsia-500/60 text-fuchsia-300"
                    : "text-muted-foreground"
                }
              >
                {status?.hasCustomKey ? "إعدادات مخصصة" : "افتراضي من البيئة"}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            هذه القيم تُستخدم الآن في كل عمليات التوليد (الاستوديو، المحادثة،
            شات جي بي تي، MCP، والأوتوبايلوت). لتغييرها استخدم البطاقة التالية.
          </p>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs leading-6">
              <p className="flex flex-wrap items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-fuchsia-400" />
                <span className="font-bold text-foreground">رابط الخدمة:</span>
                <span dir="ltr" className="font-mono text-muted-foreground">
                  {status.baseUrl}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-fuchsia-400" />
                <span className="font-bold text-foreground">مفتاح API:</span>
                {status.apiKeyMasked ? (
                  <>
                    <span dir="ltr" className="font-mono text-muted-foreground">
                      {status.apiKeyMasked}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {status.apiKeySource === "custom" ? "محفوظ من الإعدادات" : "من متغيرات البيئة"}
                    </Badge>
                    {status.hasCustomKey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                        onClick={removeCustomKey}
                      >
                        إزالة المفتاح المحفوظ
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-amber-300">غير مضبوط — أدخل مفتاحًا بالأسفل</span>
                )}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-fuchsia-400" />
                <span className="font-bold text-foreground">نموذج الصور:</span>
                <span dir="ltr" className="font-mono text-muted-foreground">
                  {status.imageModel}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <Video className="h-3.5 w-3.5 text-fuchsia-400" />
                <span className="font-bold text-foreground">نموذج الفيديو:</span>
                <span dir="ltr" className="font-mono text-muted-foreground">
                  {status.videoModel}
                </span>
              </p>
            </div>
          ) : loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              تعذر عرض الإعدادات الحالية
            </p>
          )}
        </CardContent>
      </Card>

      {/* بطاقة التغيير */}
      <Card className="border-border/70 shadow-xl shadow-black/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-fuchsia-400" />
            تغيير الرابط والمفتاح والنماذج
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            أدخل رابط الخدمة والمفتاح الجديد ثم اضغط «جلب النماذج» لتظهر لك
            قائمة النماذج المرتبطة بالمفتاح، اختر منها نموذج الصور ونموذج
            الفيديو واحفظ. الرابط يجب أن يكون متوافقًا مع واجهة المهام
            (المسار <span dir="ltr" className="font-mono">/api/v1/jobs/createTask</span> —
            مثل <span dir="ltr" className="font-mono">https://api.kie.ai</span>).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider-base-url">رابط الخدمة (Base URL)</Label>
            <Input
              id="provider-base-url"
              dir="ltr"
              placeholder="https://api.kie.ai"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-api-key">مفتاح API</Label>
            <Input
              id="provider-api-key"
              type="password"
              dir="ltr"
              placeholder={
                status?.apiKeyMasked
                  ? `المفتاح الحالي ${status.apiKeyMasked} — اتركه فارغًا لعدم التغيير`
                  : "الصق المفتاح هنا"
              }
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              يُخزَّن في قاعدة بياناتك ويظهر للخادم فقط (لا يُعرض كاملًا مطلقًا).
              للحصول على مفتاح kie.ai جديد:{" "}
              <a
                href="https://kie.ai/api-key"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-fuchsia-300 underline"
              >
                kie.ai/api-key
              </a>
            </p>
          </div>

          <Button
            type="button"
            onClick={fetchModels}
            disabled={fetching}
            className="w-full gap-2 bg-gradient-to-l from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-500 hover:to-purple-500"
          >
            {fetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            جلب النماذج المرتبطة بالمفتاح
          </Button>

          {fetchNote && (
            <Alert className="border-emerald-500/30 bg-emerald-500/10">
              <Check className="h-4 w-4 text-emerald-400" />
              <AlertTitle className="text-emerald-300">{fetchNote}</AlertTitle>
              {fetchSource === "catalog" && (
                <AlertDescription className="text-emerald-200/70">
                  تُظهر القائمة أدناه معرّفات مؤكدة معروفة — ويمكنك دائمًا
                  كتابة أي معرّف يدويًا.
                </AlertDescription>
              )}
            </Alert>
          )}

          {fetchError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>لم تتم عملية الجلب بنجاح</AlertTitle>
              <AlertDescription>{fetchError}</AlertDescription>
            </Alert>
          )}

          {models && (
            <div className="space-y-3">
              <ModelPicker
                icon={<ImageIcon className="h-4 w-4 text-fuchsia-400" />}
                title="نموذج توليد الصور"
                models={models}
                value={imageModel}
                onChange={setImageModel}
              />
              <ModelPicker
                icon={<Video className="h-4 w-4 text-fuchsia-400" />}
                title="نموذج توليد الفيديو"
                models={models}
                value={videoModel}
                onChange={setVideoModel}
              />
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 gap-2 bg-gradient-to-l from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-500 hover:to-purple-500"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              حفظ الإعدادات
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5 sm:w-auto"
                  disabled={loading}
                >
                  <RotateCcw className="h-4 w-4" />
                  استعادة الافتراضي
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>استعادة الإعدادات الافتراضية؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    ستُحذف كل الإعدادات المخصصة (الرابط، المفتاح المحفوظ،
                    النماذج المختارة) ويرجع الخادم إلى متغيرات البيئة
                    KIE_API_KEY و KIE_IMAGE_MODEL و KIE_VIDEO_MODEL.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                  <AlertDialogAction onClick={resetDefaults}>
                    نعم، استعادة
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            ملاحظة: التغييرات تُطبَّق على المهام الجديدة فورًا دون إعادة نشر —
            والمهام الجارية تبقى على المزوّد الذي أُنشئت به.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
