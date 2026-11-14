import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getGeneration, updateMerge } from "@/lib/turso";
import { absolutizeUrls } from "@/lib/http";
import type { Generation, MergeJob } from "@/lib/types";

/**
 * محرّك دمج الفيديوهات — يدمج عدة مقاطع ناجحة في ملف MP4 واحد عبر ffmpeg:
 * 1) تنزيل كل مقطع من رابط نتيجته إلى /tmp.
 * 2) محاولة دمج سريع بنسخ التدفقات (-c copy) لأن المقاطع عادة من نفس النموذج.
 * 3) عند فشل النسخ المباشر يعاد الترميز (libx264 + aac) لضمان توافق المقاطع.
 *
 * الملف الناتج يُخزَّن في /tmp ككاش مؤقت ويُبنى من جديد عند فقدانه
 * (بيئة السيرفرلس مؤقتة) — والروابط تُخدم عبر /api/merge/[id]/file.
 */

const execFileAsync = promisify(execFile);

/** أقصى عدد مقاطع في عملية الدمج الواحدة */
export const MAX_MERGE_PARTS = 8;

/** مجلد العمل المؤقت */
const TMP_DIR = "/tmp/vi-merge";

/* قفل داخلي: يمنع بناء نفس الوظيفة مرتين بالتوازي في نفس نسخة الخادم */
const inFlight = new Set<string>();

/** مسار ffmpeg: متغير بيئة → حزمة ffmpeg-static → نظام */
function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH?.trim()) return process.env.FFMPEG_PATH.trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("ffmpeg-static") as string | { default?: string };
    const p = typeof mod === "string" ? mod : mod?.default;
    if (p) {
      try {
        chmodSync(p, 0o755);
      } catch {
        /* قد يكون ملفًا للقراءة فقط — يُستكمل بالتجربة */
      }
      return p;
    }
  } catch {
    /* الحزمة غير مثبتة — نستخدم ffmpeg النظامي إن وجد */
  }
  return "ffmpeg";
}

function cachePaths(id: string, ids: string[]): { out: string; list: string } {
  mkdirSync(TMP_DIR, { recursive: true });
  const key = createHash("sha1")
    .update(`${id}:${ids.join(",")}`)
    .digest("hex")
    .slice(0, 12);
  return {
    out: path.join(TMP_DIR, `merged-${id}-${key}.mp4`),
    list: path.join(TMP_DIR, `parts-${id}-${key}.txt`),
  };
}

/** تنزيل مقطع واحد إلى ملف — يرجع مسار الملف */
async function downloadPart(
  url: string,
  dest: string,
  label: string
): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    throw new Error(`تعذر تنزيل المقطع ${label} من المزوّد (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 1024) {
    throw new Error(`المقطع ${label} فارغ أو تالف — تعذر تنزيله`);
  }
  writeFileSync(dest, buf);
  return dest;
}

/** تشغيل ffmpeg مع مهلة قصوى */
async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(ffmpegBin(), args, {
    timeout: 50_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** بناء ملف الفيديو المدمج فعليًا — يرجع مسار الملف الجاهز للبث */
export async function buildMergedFile(
  job: MergeJob,
  origin: string
): Promise<string> {
  const { out, list } = cachePaths(job.id, job.generationIds);
  if (existsSync(out) && statSync(out).size > 0) return out;

  if (inFlight.has(job.id)) {
    // بناء آخر قيد التنفيذ في نفس النسخة — ننتظره قليلًا ثم نقرأ الكاش
    for (let i = 0; i < 55; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!inFlight.has(job.id)) break;
      if (existsSync(out) && statSync(out).size > 0) return out;
    }
    if (existsSync(out) && statSync(out).size > 0) return out;
    throw new Error("عملية الدمج لا تزال قيد التنفيذ — حاول بعد لحظات");
  }
  inFlight.add(job.id);

  const partFiles: string[] = [];
  try {
    /* ---- 1) تنزيل المقاطع بالترتيب ---- */
    for (let i = 0; i < job.generationIds.length; i++) {
      const genId = job.generationIds[i]!;
      const gen: Generation | null = await getGeneration(genId);
      if (!gen) {
        throw new Error(`المقطع رقم ${i + 1} (${genId}) غير موجود في السجل`);
      }
      if (gen.type !== "video" || gen.status !== "success" || gen.resultUrls.length === 0) {
        throw new Error(
          `المقطع رقم ${i + 1} غير مكتمل — يجب أن تكتمل كل المقاطع بنجاح قبل الدمج`
        );
      }
      const urls = absolutizeUrls(gen.resultUrls, origin);
      const dest = path.join(TMP_DIR, `part-${job.id}-${i}.mp4`);
      await downloadPart(urls[0]!, dest, `(${i + 1})`);
      partFiles.push(dest);
    }

    /* ---- 2) قائمة الدمج ---- */
    writeFileSync(
      list,
      partFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
      "utf-8"
    );

    /* ---- 3) دمج سريع بنسخ التدفقات ثم إعادة ترميز احتياطية ---- */
    try {
      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list,
        "-c", "copy",
        "-movflags", "+faststart",
        out,
      ]);
    } catch {
      // المقاطع قد تختلف في الترميز — إعادة ترميز موحّدة
      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        out,
      ]);
    }

    if (!existsSync(out) || statSync(out).size === 0) {
      throw new Error("أنتج ffmpeg ملفًا فارغًا — تعذر الدمج");
    }
    return out;
  } finally {
    for (const f of partFiles) {
      try {
        unlinkSync(f);
      } catch {
        /* تنظيف عابر */
      }
    }
    try {
      unlinkSync(list);
    } catch {
      /* تنظيف عابر */
    }
    inFlight.delete(job.id);
  }
}

/** البناء مع تحديث حالة الوظيفة في قاعدة البيانات */
export async function runMergeJob(job: MergeJob, origin: string): Promise<void> {
  try {
    await buildMergedFile(job, origin);
    await updateMerge(job.id, { status: "success", error: null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر دمج المقاطع — خطأ غير متوقع";
    await updateMerge(job.id, { status: "fail", error: message });
  }
}

/** كشف حجم الملف المدمج من الكاش (إن وُجد) */
export function mergedFileSize(job: MergeJob): number | null {
  const { out } = cachePaths(job.id, job.generationIds);
  try {
    return existsSync(out) ? statSync(out).size : null;
  } catch {
    return null;
  }
}
