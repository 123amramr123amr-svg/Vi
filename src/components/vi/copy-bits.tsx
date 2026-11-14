"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/** نسخ نص إلى الحافظة مع تأكيد بصري — مشترك بين الأدلة */
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

/** صف رابط كامل مع زر نسخ — يبني الرابط من دومين الصفحة الحالي */
export function UrlRow({
  label,
  path,
  title,
}: {
  label: string;
  path: string;
  title: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
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
