/**
 * تكامل مع منصة kie.ai (واجهة المهام الموحدة).
 * التوثيق: https://docs.kie.ai — POST /api/v1/jobs/createTask ثم GET /api/v1/jobs/recordInfo
 */

const KIE_BASE_URL = "https://api.kie.ai";

/** نموذج توليد الصور (يمكن تغييره عبر متغير البيئة KIE_IMAGE_MODEL) */
export const IMAGE_MODEL =
  process.env.KIE_IMAGE_MODEL ?? "gpt-image-2-6/flare-text-to-image";

/** نموذج توليد الفيديو (يمكن تغييره عبر متغير البيئة KIE_VIDEO_MODEL) */
export const VIDEO_MODEL =
  process.env.KIE_VIDEO_MODEL ?? "grok-imagine-video-1-5-preview";

export interface KieTaskState {
  state: string;
  resultUrls: string[];
  failMsg: string | null;
}

function authHeaders(): Record<string, string> {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new Error(
      "مفتاح KIE_API_KEY غير مضبوط على الخادم — أضفه إلى متغيرات البيئة"
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** إنشاء مهمة توليد جديدة وإرجاع معرّفها لدى kie.ai */
export async function createKieTask(
  model: string,
  input: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ model, input }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { taskId?: string } }
    | null;

  if (!json || json.code !== 200 || !json.data?.taskId) {
    const msg = json?.msg ?? `HTTP ${res.status}`;
    throw new Error(`تعذر إنشاء مهمة التوليد عند المزوّد: ${msg}`);
  }
  return json.data.taskId;
}

/** الاستعلام عن حالة المهمة واستخراج روابط النتائج */
export async function getKieTask(taskId: string): Promise<KieTaskState> {
  const res = await fetch(
    `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { headers: authHeaders(), cache: "no-store" }
  );

  const json = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: Record<string, unknown> }
    | null;

  if (!json || json.code !== 200 || !json.data) {
    const msg = json?.msg ?? `HTTP ${res.status}`;
    throw new Error(`تعذر الاستعلام عن حالة المهمة: ${msg}`);
  }

  const data = json.data;
  let resultUrls: string[] = [];
  if (typeof data.resultJson === "string" && data.resultJson.length > 0) {
    try {
      const parsed = JSON.parse(data.resultJson) as Record<string, unknown>;
      if (Array.isArray(parsed.resultUrls)) {
        resultUrls = (parsed.resultUrls as unknown[]).filter(
          (u): u is string => typeof u === "string" && u.length > 0
        );
      } else if (
        typeof parsed.result === "object" &&
        parsed.result !== null &&
        Array.isArray((parsed.result as Record<string, unknown>).resultUrls)
      ) {
        resultUrls = ((parsed.result as Record<string, unknown>).resultUrls as unknown[]).filter(
          (u): u is string => typeof u === "string" && u.length > 0
        );
      }
    } catch {
      resultUrls = [];
    }
  }

  const state = typeof data.state === "string" ? data.state : "waiting";
  const failMsg =
    (typeof data.failMsg === "string" && data.failMsg) ||
    (typeof data.failCode === "string" && data.failCode) ||
    null;

  return { state, resultUrls, failMsg };
}
