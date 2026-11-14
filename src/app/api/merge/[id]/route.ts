import { NextRequest, NextResponse } from "next/server";

import { runMergeJob } from "@/lib/merge";
import { requestOrigin } from "@/lib/http";
import { deleteMerge, ensureSchema, getMerge } from "@/lib/turso";
import type { MergeJob } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** أقصى انتظار داخل الطلب الواحد (ثوانٍ) عند ?wait=N */
const MAX_WAIT_SECONDS = 45;

function serialize(job: MergeJob) {
  return {
    id: job.id,
    generationIds: job.generationIds,
    status: job.status,
    error: job.error,
    fileUrl: job.fileUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * GET /api/merge/[id] — حالة وظيفة الدمج.
 * ?wait=N: الانتظار داخل الطلب حتى اكتمال البناء (حتى 45 ثانية) —
 * وإذا ظلت الوظيفة «قيد التنفيذ» طويلًا بلا نتيجة (مثل سقوط نسخة الخادم)
 * يُعاد البناء من جديد.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;

  const waitRaw = Number(req.nextUrl.searchParams.get("wait") ?? "0");
  const waitSeconds = Number.isFinite(waitRaw)
    ? Math.min(Math.max(Math.floor(waitRaw), 0), MAX_WAIT_SECONDS)
    : 0;

  let job = await getMerge(id);
  if (!job) {
    return NextResponse.json({ error: "وظيفة الدمج غير موجودة" }, { status: 404 });
  }

  const deadline = Date.now() + waitSeconds * 1000;
  while (job.status === "processing" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const next = await getMerge(id);
    if (!next) break;
    job = next;
  }

  /* ظلت «قيد التنفيذ» حتى نهاية الانتظار → البناء الأصلي سقط، أعِده */
  if (job.status === "processing") {
    await runMergeJob(job, requestOrigin(req));
    const rebuilt = await getMerge(id);
    if (rebuilt) job = rebuilt;
  }

  return NextResponse.json({ item: serialize(job) });
}

/** DELETE /api/merge/[id] — حذف وظيفة الدمج من السجل */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSchema();
  const { id } = await params;
  await deleteMerge(id);
  return NextResponse.json({ ok: true });
}
