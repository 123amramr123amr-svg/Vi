/**
 * تكامل مع مزوّد التوليد (واجهة المهام الموحدة المتوافقة مع kie.ai).
 * التوثيق: https://docs.kie.ai — POST /api/v1/jobs/createTask ثم GET /api/v1/jobs/recordInfo
 *
 * الرابط والمفتاح يمكن تمريرهما ديناميكيًا من إعدادات التطبيق (تبويب الإعدادات)،
 * وإلا يُرجع إلى متغيرات البيئة KIE_API_KEY والرابط الافتراضي https://api.kie.ai.
 */

const DEFAULT_BASE_URL = "https://api.kie.ai";

/** نموذج توليد الصور (يمكن تغييره عبر متغير البيئة KIE_IMAGE_MODEL أو من الإعدادات) */
export const IMAGE_MODEL =
  process.env.KIE_IMAGE_MODEL ?? "gpt-image-2-6/flare-text-to-image";

/** نموذج توليد الفيديو (يمكن تغييره عبر متغير البيئة KIE_VIDEO_MODEL أو من الإعدادات) */
export const VIDEO_MODEL =
  process.env.KIE_VIDEO_MODEL ?? "grok-imagine-video-1-5-preview";

/** إعداد المزوّد الواجب استخدامه لاستدعاء واحد (من إعدادات قاعدة البيانات) */
export interface KieConfig {
  baseUrl: string;
  apiKey: string | null;
}

export interface KieTaskState {
  state: string;
  resultUrls: string[];
  failMsg: string | null;
}

function resolveKey(cfg?: KieConfig): string | null {
  const key = cfg?.apiKey?.trim() || process.env.KIE_API_KEY?.trim() || null;
  if (!key) {
    throw new Error(
      "لا يوجد مفتاح API مضبوط — أضف المفتاح من تبويب الإعدادات أو ضبط KIE_API_KEY على الخادم"
    );
  }
  return key;
}

function baseUrl(cfg?: KieConfig): string {
  const raw = cfg?.baseUrl?.trim();
  if (!raw) return DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function authHeaders(cfg?: KieConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${resolveKey(cfg)}`,
    "Content-Type": "application/json",
  };
}

/** إنشاء مهمة توليد جديدة وإرجاع معرّفها لدى المزوّد */
export async function createKieTask(
  model: string,
  input: Record<string, unknown>,
  cfg?: KieConfig
): Promise<string> {
  const res = await fetch(`${baseUrl(cfg)}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({ model, input }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
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
export async function getKieTask(
  taskId: string,
  cfg?: KieConfig
): Promise<KieTaskState> {
  const res = await fetch(
    `${baseUrl(cfg)}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    {
      headers: authHeaders(cfg),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }
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
