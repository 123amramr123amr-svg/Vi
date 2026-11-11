import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Sparkles } from "lucide-react";

import { listPublished, ensureSchema } from "@/lib/turso";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "معرض المنشورات — Vi AI Studio",
  description: "أعمال مولّدة بالذكاء الاصطناعي ونُشرت تلقائيًا على الموقع",
};

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ts));
}

export default async function GalleryPage() {
  let items: Awaited<ReturnType<typeof listPublished>> = [];
  let dbError = false;
  try {
    await ensureSchema();
    items = await listPublished(60);
  } catch {
    dbError = true;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-lg font-black text-white shadow-lg shadow-fuchsia-500/25">
              V
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-none">
                معرض المنشورات
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                أعمال مولّدة بالذكاء الاصطناعي ونُشرت على الموقع
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:border-fuchsia-500/50 hover:text-fuchsia-300"
          >
            ← الاستوديو
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {dbError ? (
          <p className="rounded-xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
            تعذر تحميل المعرض حاليًا — حاول تحديث الصفحة.
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-12 text-center">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-fuchsia-400" />
            <p className="font-bold">لا توجد أعمال منشورة بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">
              ستظهر هنا تلقائيًا الصور والفيديوهات التي ينشرها الأوتوبايلوت
              أو شات جي بي تي.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const url = item.resultUrls[0];
              if (!url) return null;
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg shadow-black/10"
                >
                  <div className="bg-black/40" dir="ltr">
                    {item.type === "image" ? (
                      <img
                        src={url}
                        alt={item.prompt}
                        loading="lazy"
                        className="max-h-[420px] w-full object-cover"
                      />
                    ) : (
                      <video
                        src={url}
                        controls
                        loop
                        playsInline
                        className="max-h-[420px] w-full"
                      />
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold text-fuchsia-300">
                        <Clapperboard className="h-3 w-3" />
                        {item.type === "image" ? "صورة" : "فيديو"}
                      </span>
                      {item.params.autopilot && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          نشر تلقائي
                        </span>
                      )}
                      <span className="ms-auto text-[10px] text-muted-foreground">
                        {item.publishedAt
                          ? formatDate(item.publishedAt)
                          : formatDate(item.createdAt)}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {item.prompt}
                    </p>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-bold text-fuchsia-300 underline"
                    >
                      فتح الأصل بجودة كاملة ↗
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        Vi AI Studio — يُحدَّث المعرض تلقائيًا كل يوم عبر الأوتوبايلوت
      </footer>
    </div>
  );
}
