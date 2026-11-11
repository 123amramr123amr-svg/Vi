"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ExternalLink,
  KeyRound,
  Loader2,
  SendHorizontal,
  Settings2,
  Sparkles,
  Trash2,
  User,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { STATUS_LABEL, isActiveStatus, type Generation } from "@/lib/types";

/* ---------- أدوات تحليل ردود المساعد ---------- */

interface GeneratePayload {
  type?: string;
  prompt?: string;
  duration?: number;
  resolution?: string;
}

interface Segment {
  kind: "text" | "generate";
  text?: string;
  payload?: GeneratePayload;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface GenState {
  id: string;
  type: "image" | "video";
  status: string;
  resultUrls: string[];
  error: string | null;
}

const VI_GENERATE_RE = /```vi-generate\s*([\s\S]*?)```/g;

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  VI_GENERATE_RE.lastIndex = 0;
  while ((m = VI_GENERATE_RE.exec(content)) !== null) {
    if (m.index > last) {
      segments.push({ kind: "text", text: content.slice(last, m.index) });
    }
    let payload: GeneratePayload | undefined;
    try {
      payload = JSON.parse(m[1].trim()) as GeneratePayload;
    } catch {
      payload = undefined;
    }
    segments.push({ kind: "generate", payload });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ kind: "text", text: content.slice(last) });
  }
  return segments;
}

const SUGGESTIONS = [
  "ساعدني في صياغة وصف صورة احترافية لمنتج عطور فاخر",
  "أفكار فيديو قصير مميز لسوشيال ميديا عن مقهى جديد",
  "ولّد لي صورة قط فضائي يشرب قهوة على القمر",
];

/* ---------- المكوّن الرئيسي ---------- */

export function ChatPanel({
  onOpenResult,
}: {
  onOpenResult: (item: Generation) => void;
}) {
  const { toast } = useToast();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);

  const [openaiKey, setOpenaiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [genStates, setGenStates] = useState<Record<string, GenState>>({});
  const genStatesRef = useRef(genStates);
  genStatesRef.current = genStates;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* تحميل السجل ومفتاح المستخدم */
  useEffect(() => {
    setOpenaiKey(localStorage.getItem("vi_openai_key") ?? "");
    (async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { messages: ChatMsg[] };
          setMessages(data.messages ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* تمرير تلقائي لآخر رسالة */
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, sending]);

  /* استعلام دوري عن حالة المهام المفتوحة من المحادثة */
  useEffect(() => {
    const timer = setInterval(async () => {
      const states = genStatesRef.current;
      const activeIds = Object.entries(states).filter(([, s]) =>
        isActiveStatus(s.status as Generation["status"])
      );
      for (const [msgId, s] of activeIds) {
        try {
          const res = await fetch(`/api/generations/${s.id}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { item?: Generation };
          if (!data.item) continue;
          setGenStates((prev) => ({
            ...prev,
            [msgId]: {
              id: data.item!.id,
              type: data.item!.type,
              status: data.item!.status,
              resultUrls: data.item!.resultUrls,
              error: data.item!.error,
            },
          }));
        } catch {
          /* عابر */
        }
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(openaiKey.trim()
            ? { "x-openai-key": openaiKey.trim() }
            : {}),
        },
        body: JSON.stringify({ message: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        provider?: string;
      };
      if (!res.ok || typeof data.reply !== "string") {
        throw new Error(data.error ?? "تعذر الحصول على رد المساعد");
      }
      if (data.provider) setProviderLabel(data.provider);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply!,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      toast({
        title: "خطأ في المحادثة",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [input, sending, openaiKey, toast]);

  const clearChat = useCallback(async () => {
    setMessages([]);
    setGenStates({});
    try {
      await fetch("/api/chat", { method: "DELETE" });
      toast({ title: "تم مسح المحادثة" });
    } catch {
      toast({ title: "تعذر مسح المحادثة", variant: "destructive" });
    }
  }, [toast]);

  const startGeneration = useCallback(
    async (msgId: string, payload: GeneratePayload) => {
      const type = payload.type === "video" ? "video" : "image";
      try {
        setGenStates((prev) => ({
          ...prev,
          [msgId]: {
            id: "",
            type,
            status: "pending",
            resultUrls: [],
            error: null,
          },
        }));
        const body =
          type === "image"
            ? { type, prompt: payload.prompt, aspectRatio: "auto", resolution: "1K" }
            : {
                type,
                prompt: payload.prompt,
                aspectRatio: "auto",
                resolution: payload.resolution ?? "720p",
                duration: payload.duration ?? 8,
                enableAudio: true,
              };
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          error?: string;
        };
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "تعذر إنشاء مهمة التوليد");
        }
        setGenStates((prev) => ({
          ...prev,
          [msgId]: {
            id: data.id!,
            type,
            status: "waiting",
            resultUrls: [],
            error: null,
          },
        }));
      } catch (err) {
        setGenStates((prev) => {
          const next = { ...prev };
          delete next[msgId];
          return next;
        });
        toast({
          title: "خطأ",
          description: err instanceof Error ? err.message : "حاول مرة أخرى",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const openResult = useCallback(
    async (state: GenState) => {
      try {
        const res = await fetch(`/api/generations/${state.id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { item?: Generation };
        if (data.item) onOpenResult(data.item);
      } catch {
        toast({ title: "تعذر فتح النتيجة", variant: "destructive" });
      }
    },
    [onOpenResult, toast]
  );

  function saveKey() {
    const trimmed = keyDraft.trim();
    setOpenaiKey(trimmed);
    localStorage.setItem("vi_openai_key", trimmed);
    setSettingsOpen(false);
    toast({
      title: trimmed ? "تم حفظ مفتاح OpenAI" : "تمت إزالة مفتاح OpenAI",
      description: trimmed
        ? "ستستخدم المحادثة الآن مفتاح ChatGPT الخاص بك."
        : "ستعود المحادثة إلى المزوّد الافتراضي.",
    });
  }

  return (
    <Card className="flex min-h-[70vh] flex-col border-border/70 shadow-xl shadow-black/10">
      <CardContent className="flex flex-1 flex-col p-0">
        {/* رأس المحادثة */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="me-auto">
            <h3 className="text-sm font-extrabold leading-tight">
              مساعد شات جي بي تي
            </h3>
            <p className="text-[11px] text-muted-foreground">
              يصيغ لك الأوصاف ويولّد الصور والفيديو من داخل المحادثة
            </p>
          </div>
          {providerLabel && (
            <Badge
              variant="outline"
              className="text-[10px] font-mono"
              dir="ltr"
            >
              {providerLabel}
            </Badge>
          )}
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                aria-label="إعدادات مفتاح OpenAI"
              >
                <Settings2 className="h-4 w-4" />
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ربط مفتاح ChatGPT الخاص بك</DialogTitle>
                <DialogDescription>
                  اتركه فارغًا لاستخدام مزوّد المحادثة الافتراضي (kie.ai).
                  مفتاحك يُحفظ في متصفحك فقط ولا يُخزَّن على الخادم.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="openai-key">مفتاح OpenAI API</Label>
                <Input
                  id="openai-key"
                  type="password"
                  dir="ltr"
                  placeholder="sk-..."
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  يمكنك الحصول على المفتاح من{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-fuchsia-300 underline"
                  >
                    platform.openai.com/api-keys
                  </a>
                </p>
              </div>
              <DialogFooter>
                <Button onClick={saveKey}>حفظ</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="gap-1.5 text-muted-foreground"
            aria-label="مسح المحادثة"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* الرسائل */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto p-4"
          style={{ maxHeight: "58vh" }}
        >
          {loading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-fuchsia-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="grid place-items-center gap-4 py-8 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-purple-600/20">
                <Bot className="h-7 w-7 text-fuchsia-300" />
              </div>
              <div>
                <h4 className="font-bold">مرحبًا! أنا مساعد Vi 👋</h4>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  اسألني أي شيء، أو اطلب مني صياغة وصف احترافي ثم ولّد الصورة أو
                  الفيديو مباشرة من هنا.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-xs transition hover:border-fuchsia-500/50 hover:bg-fuchsia-500/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${
                  msg.role === "user" ? "flex-row-reverse justify-start" : ""
                }`}
              >
                <div
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    msg.role === "user"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <div
                  className={`max-w-[85%] space-y-2.5 rounded-2xl px-4 py-3 text-sm leading-6 ${
                    msg.role === "user"
                      ? "rounded-se-none bg-primary text-primary-foreground"
                      : "rounded-ss-none border border-border/60 bg-muted/50"
                  }`}
                >
                  {parseSegments(msg.content).map((seg, i) =>
                    seg.kind === "text" ? (
                      <p key={i} className="whitespace-pre-wrap">
                        {seg.text?.trim()}
                      </p>
                    ) : (
                      <GenerateCard
                        key={i}
                        payload={seg.payload}
                        state={genStates[msg.id]}
                        onGenerate={() => startGeneration(msg.id, seg.payload!)}
                        onOpenResult={() =>
                          genStates[msg.id] &&
                          openResult(genStates[msg.id])
                        }
                      />
                    )
                  )}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-start gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-ss-none border border-border/60 bg-muted/50 px-4 py-3.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-fuchsia-400" />
              </div>
            </div>
          )}
        </div>

        {/* حقل الإدخال */}
        <div className="border-t border-border/60 p-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد)"
              rows={2}
              className="max-h-32 min-h-11 flex-1 resize-none bg-input/40"
              aria-label="رسالة المحادثة"
            />
            <Button
              onClick={send}
              disabled={sending || !input.trim()}
              size="icon"
              aria-label="إرسال"
              className="h-11 w-11 shrink-0 bg-gradient-to-br from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-500 hover:to-purple-500"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <SendHorizontal className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- بطاقة التوليد داخل المحادثة ---------- */

function GenerateCard({
  payload,
  state,
  onGenerate,
  onOpenResult,
}: {
  payload?: GeneratePayload;
  state?: GenState;
  onGenerate: () => void;
  onOpenResult: () => void;
}) {
  if (
    !payload ||
    (payload.type !== "image" && payload.type !== "video") ||
    !payload.prompt
  ) {
    return (
      <p className="text-xs text-muted-foreground">
        ⚠️ تعذر قراءة بيانات التوليد في هذا الرد.
      </p>
    );
  }
  const isVideo = payload.type === "video";
  const url = state?.resultUrls?.[0] ?? null;

  return (
    <div className="space-y-2 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-fuchsia-300">
        <Wand2 className="h-3.5 w-3.5" />
        {isVideo ? "وصف فيديو جاهز" : "وصف صورة جاهز"}
      </p>
      <p className="text-xs leading-5 text-muted-foreground" dir="auto">
        {payload.prompt}
      </p>

      {!state ? (
        <Button
          size="sm"
          onClick={onGenerate}
          className="gap-1.5 bg-gradient-to-l from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-500 hover:to-purple-500"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isVideo ? "توليد الفيديو الآن" : "توليد الصورة الآن"}
        </Button>
      ) : isActiveStatus(state.status as Generation["status"]) ? (
        <p className="flex items-center gap-2 text-xs font-bold text-fuchsia-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {STATUS_LABEL[state.status as Generation["status"]] ?? state.status}…
        </p>
      ) : state.status === "success" && url ? (
        <div className="space-y-2">
          {state.type === "image" ? (
            <img
              src={url}
              alt="نتيجة التوليد"
              className="max-h-48 rounded-lg border border-border/60"
            />
          ) : (
            <video
              src={url}
              controls
              loop
              playsInline
              className="max-h-48 w-full rounded-lg border border-border/60"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={onOpenResult}
            >
              <ExternalLink className="h-3.5 w-3.5" /> عرض في الاستوديو
            </Button>
            <a href={url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> فتح الرابط
              </Button>
            </a>
          </div>
        </div>
      ) : (
        <p className="text-xs text-red-300">
          فشل التوليد: {state.error ?? "حاول مرة أخرى"}
        </p>
      )}
    </div>
  );
}
