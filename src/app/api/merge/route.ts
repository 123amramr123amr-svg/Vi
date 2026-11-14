import { NextRequest, NextResponse } from "next/server";

import { requestOrigin } from "@/lib/http";
import { MergeRequestError, createMergeJob } from "@/lib/merge-service";
import { ensureSchema, listMerges } from "@/lib/turso";
import type { MergeJob } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function serialize(m: MergeJob) {
  return {
    id: m.id,
    generationIds: m.generationIds,
    status: m.status,
    error: m.error,
    fileUrl: m.fileUrl,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** GET /api/merge — قائمة وظائف الدمج الأخيرة */
export async function GET() {
  await ensureSchema();
  const items = await listMerges(30);
  return NextResponse.json({ items: items.map(serialize) });
}

/**
 * POST /api/merge — دمج عدة فيديوهات مكتملة في مقطع واحد.
 * يُتحقق من صلاحية المقاطع فورًا، ثم يبدأ البناء خلف الرد (after)
 * والمستعرض يستعلم GET /api/merge/[id] حتى status = success.
 * الجسم: { generationIds: ["id1","id2",…] } بالترتيب المطلوب (2-8 مقاطع).
 */
export async function POST(req: NextRequest) {
  await ensureSchema();

  const raw = (await req.json().catch(() => null)) as {
    generationIds?: unknown;
  } | null;
  const ids = Array.isArray(raw?.generationIds)
    ? raw!.generationIds.filter((x): x is string => typeof x === "string")
    : [];

  try {
    const job = await createMergeJob(ids, requestOrigin(req));
    return NextResponse.json({ ok: true, ...serialize(job) }, { status: 201 });
  } catch (err) {
    if (err instanceof MergeRequestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر إنشاء وظيفة الدمج" },
      { status: 502 }
    );
  }
}
