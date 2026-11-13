/**
 * محوّل مزوّد التوليد الموحد — يدعم أي رابط أساسي لأي مفتاح:
 *
 * 1) واجهة المهام الموحدة (نمط kie.ai):
 *    POST {base}/api/v1/jobs/createTask → GET {base}/api/v1/jobs/recordInfo
 *
 * 2) الواجهة المتوافقة مع OpenAI:
 *    الصور: POST {base}/images/generations (رد متزامن data[].url | b64_json)
 *    الفيديو: POST {base}/videos ثم GET {base}/videos/{id} (نمط Sora)
 *    وعند اكتمال الفيديو بدون رابط عام يُخدم المحتوى عبر بروكسي
 *    /api/media/[id] (نقطة نهاية /videos/{id}/content).
 *
 * الرابط الأساسي قد يحتوي مسارًا (مثل https://openrouter.ai/api/v1) —
 * تُشتق المرشّحات تلقائيًا حسب شكل الرابط، وتُجرَّب بالترتيب حتى ينجح أحدها.
 */

export type ProviderKind = "jobs" | "openai-image" | "openai-video";

/** لقطة تُحفظ مع كل مهمة ليعمل الاستعلام لدى نفس المزوّد الذي أُنشئت به */
export interface ProviderSnapshot {
  kind: ProviderKind;
  baseUrl: string;
  /** جذر الواجهة الذي نجح الإنشاء عبره: …/api/v1/jobs أو …/v1 */
  prefix: string;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string | null;
}

export interface CreatedTask {
  kind: ProviderKind;
  taskId: string | null;
  prefix: string;
  /** نتائج فورية (واجهة OpenAI المتزامنة) — إن وُجدت تكون المهمة مكتملة مباشرة */
  immediateUrls: string[];
}

export interface RemoteTaskState {
  state: "pending" | "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  failMsg: string | null;
}

/* ------------------------- أدوات الروابط ------------------------- */

function splitBase(base: string): {
  hostRoot: string;
  path: string;
  base: string;
  isVersioned: boolean;
} {
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, "");
  return {
    hostRoot: `${u.protocol}//${u.host}`,
    path,
    base: `${u.protocol}//${u.host}${path}`,
    isVersioned: /\/v\d+$/i.test(path),
  };
}

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

/** مرشّحات قائمة النماذج بالترتيب (من الأكثر شيوعًا إلى الأقل) */
export function modelsEndpoints(base: string): string[] {
  const { hostRoot, path, base: b, isVersioned } = splitBase(base);
  if (!path)
    return uniq([
      `${hostRoot}/v1/models`,
      `${hostRoot}/api/v1/models`,
      `${hostRoot}/models`,
    ]);
  if (isVersioned)
    return uniq([
      `${b}/models`,
      `${hostRoot}/v1/models`,
      `${hostRoot}/api/v1/models`,
    ]);
  return uniq([`${b}/v1/models`, `${b}/models`, `${hostRoot}/v1/models`]);
}

/** جذور واجهة المهام (نمط kie) — يُضاف إليها /createTask و /recordInfo */
export function jobsPrefixes(base: string): string[] {
  const { hostRoot, path, base: b, isVersioned } = splitBase(base);
  if (!path) return uniq([`${hostRoot}/api/v1/jobs`, `${hostRoot}/v1/jobs`]);
  if (isVersioned) {
    const root = b.replace(/\/v\d+$/i, "");
    return uniq([
      `${b}/jobs`,
      ...(path.toLowerCase().endsWith("/api/v1") ? [] : [`${root}/api/v1/jobs`]),
    ]);
  }
  return uniq([
    `${b}/api/v1/jobs`,
    `${b}/v1/jobs`,
    `${hostRoot}/api/v1/jobs`,
  ]);
}

/** جذور الواجهة المتوافقة مع OpenAI — يُضاف إليها /models و /images/generations و /videos */
export function openaiPrefixes(base: string): string[] {
  const { hostRoot, path, base: b, isVersioned } = splitBase(base);
  if (!path) return uniq([`${hostRoot}/v1`]);
  if (isVersioned) return uniq([b]);
  return uniq([`${b}/v1`, `${hostRoot}/v1`]);
}

/** ترويسات تصديق تعمل مع أكبر عدد من المزوّدين (Bearer + x-api-key معًا) */
export function providerHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    // بعض المزوّدين (بنمط Anthropic) يقرأون المفتاح من x-api-key — الترويسة
    // الإضافية يتم تجاهلها من المزوّدين الذين لا يستخدمونها
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

/* ------------------------- أدوات التحليل ------------------------- */

/** خطأ تصديق (مفتاح مرفوض) — يوقف تجربة بقية المرشّحات فورًا */
export class ProviderAuthError extends Error {}

async function errMsg(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as unknown;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.msg === "string" && obj.msg) return obj.msg;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    const error = obj.error;
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object") {
      const m = (error as Record<string, unknown>).message;
      if (typeof m === "string" && m) return m;
    }
  }
  return `HTTP ${res.status}`;
}

/** استخراج معرّف المهمة من رد واجهة المهام (نمط kie أو شكل عام) */
function parseJobsTaskId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.code === "number" && obj.code !== 200) return null;
  const data = (obj.data ?? obj) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  for (const field of ["taskId", "task_id", "id", "jobId"]) {
    if (typeof data[field] === "string" && (data[field] as string).trim())
      return (data[field] as string).trim();
  }
  return null;
}

/** تحليل حالة مهمة واجهة المهام (recordInfo) — استخراج الروابط والفشل */
function parseJobsRecord(json: unknown): RemoteTaskState {
  const obj = json as Record<string, unknown>;
  const data = (obj.data ?? {}) as Record<string, unknown>;
  let resultUrls: string[] = [];
  if (typeof data.resultJson === "string" && data.resultJson.length > 0) {
    try {
      const parsed = JSON.parse(data.resultJson) as unknown;
      resultUrls = extractUrls(parsed);
    } catch {
      resultUrls = [];
    }
  } else {
    resultUrls = extractUrls(data);
  }

  const state = typeof data.state === "string" ? data.state.toLowerCase() : "waiting";
  const failMsg =
    (typeof data.failMsg === "string" && data.failMsg) ||
    (typeof data.failCode === "string" && data.failCode) ||
    null;

  if (state === "success" || state === "succeeded" || state === "completed")
    return { state: "success", resultUrls, failMsg: null };
  if (state === "fail" || state === "failed" || state === "error")
    return { state: "fail", resultUrls, failMsg: failMsg ?? "فشل التوليد" };
  if (state === "generating" || state === "in_progress" || state === "processing")
    return { state: "generating", resultUrls, failMsg: null };
  if (state === "queuing" || state === "queued")
    return { state: "queuing", resultUrls, failMsg: null };
  return { state: "waiting", resultUrls, failMsg: null };
}

/**
 * استخراج روابط النتائج من أي رد JSON — البحث في المفاتيح
 * الشبيهة بالروابط (url/video_url/resultUrls/output …) بشكل تعاودي.
 */
export function extractUrls(json: unknown, depth = 0): string[] {
  if (depth > 6 || json == null) return [];
  const URL_KEY = /url|uri|video|image|output|result|download|asset|content|link/i;
  if (typeof json === "string")
    return /^https?:\/\/\S+$/i.test(json) && json.length <= 2000 ? [json] : [];
  if (Array.isArray(json))
    return json.flatMap((v) => extractUrls(v, depth + 1));
  if (typeof json === "object") {
    const out: string[] = [];
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (URL_KEY.test(k)) {
        if (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) && v.length <= 2000)
          out.push(v);
        else out.push(...extractUrls(v, depth + 1));
      }
    }
    return out;
  }
  return [];
}

/** استخراج نتائج الصور من رد /images/generations (url أو b64_json) */
function imageResults(json: unknown): string[] {
  const obj = json as Record<string, unknown> | null;
  const data = obj?.data;
  if (!Array.isArray(data)) {
    // بعض المزوّدين يردون {images:[...]} أو رابطًا واحدًا
    const urls = extractUrls(json);
    return urls;
  }
  const out: string[] = [];
  for (const it of data) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o.url === "string" && o.url.startsWith("http")) out.push(o.url);
    else if (typeof o.b64_json === "string" && o.b64_json.length > 0)
      out.push(`data:image/png;base64,${o.b64_json}`);
  }
  return out.length > 0 ? out : extractUrls(json);
}

/* ------------------------- إنشاء المهام ------------------------- */

export interface CreateTaskArgs {
  type: "image" | "video";
  model: string;
  /** مدخلات واجهة المهام (نمط kie): prompt/aspect_ratio/… */
  input: Record<string, unknown>;
  /** الوصف النصي — يُستخدم في الواجهة المتوافقة مع OpenAI */
  prompt: string;
  cfg: ProviderConfig;
  /** منع الرجوع إلى واجهة OpenAI (لتكملة الفيديو التي تعتمد task_id لدى kie) */
  jobsOnly?: boolean;
  /** مقاس الصور للواجهة المتوافقة مع OpenAI مثل "1024x1536" */
  openaiImageSize?: string;
  /** مدة/مقاس الفيديو للواجهة المتوافقة مع OpenAI (نمط Sora) */
  openaiVideo?: { seconds?: string; size?: string; imageUrl?: string };
}

/**
 * إنشاء مهمة توليد لدى المزوّد:
 * 1) تُجرَّب واجهة المهام (نمط kie) عبر كل المرشّحات المحتملة.
 * 2) إن لم تدعمها الخدمة (404/405) يُجرَّب الوضع المتوافق مع OpenAI.
 * تُرمى ProviderAuthError فورًا عند رفض المفتاح (401/403).
 */
export async function createGenerationTask(
  args: CreateTaskArgs
): Promise<CreatedTask> {
  const key = args.cfg.apiKey?.trim();
  if (!key) {
    throw new Error(
      "لا يوجد مفتاح API مضبوط — أضف المفتاح من تبويب الإعدادات أو ضبط KIE_API_KEY على الخادم"
    );
  }
  const headers = providerHeaders(key);
  const tried: string[] = [];

  /* ---- 1) واجهة المهام (نمط kie.ai) ---- */
  for (const prefix of jobsPrefixes(args.cfg.baseUrl)) {
    const endpoint = `${prefix}/createTask`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: args.model, input: args.input }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(
          `رفض المزوّد المفتاح (${res.status}) — ${await errMsg(res)}`
        );
      }
      const json = (await res.json().catch(() => null)) as unknown;
      const taskId = parseJobsTaskId(json);
      if (taskId) return { kind: "jobs", taskId, prefix, immediateUrls: [] };
      const msg =
        json && typeof json === "object" && "msg" in json
          ? String((json as Record<string, unknown>).msg)
          : `HTTP ${res.status}`;
      tried.push(`${endpoint}: ${msg}`);
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      tried.push(
        `${endpoint}: ${err instanceof Error ? err.message : "فشل الاتصال"}`
      );
    }
  }

  if (args.jobsOnly) {
    throw new Error(
      `تعذر إنشاء مهمة التكملة لدى المزوّد (تتطلب واجهة المهام نمط kie) — ${tried.slice(0, 3).join(" | ")}`
    );
  }

  /* ---- 2) الواجهة المتوافقة مع OpenAI ---- */
  const oaiPrefix = openaiPrefixes(args.cfg.baseUrl)[0]!;

  if (args.type === "image") {
    const endpoint = `${oaiPrefix}/images/generations`;
    const body: Record<string, unknown> = {
      model: args.model,
      prompt: args.prompt,
      n: 1,
    };
    if (args.openaiImageSize) body.size = args.openaiImageSize;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(
          `رفض المزوّد المفتاح (${res.status}) — ${await errMsg(res)}`
        );
      }
      const json = (await res.json().catch(() => null)) as unknown;
      const urls = res.ok ? imageResults(json) : [];
      if (urls.length > 0) {
        const id =
          json &&
          typeof json === "object" &&
          typeof (json as Record<string, unknown>).id === "string"
            ? ((json as Record<string, unknown>).id as string)
            : null;
        return { kind: "openai-image", taskId: id, prefix: oaiPrefix, immediateUrls: urls };
      }
      const msg = res.ok
        ? "لم يُرجع المزوّد نتائج"
        : await errMsg(res);
      tried.push(`${endpoint}: ${msg}`);
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      tried.push(
        `${endpoint}: ${err instanceof Error ? err.message : "فشل الاتصال"}`
      );
    }
  } else {
    const endpoint = `${oaiPrefix}/videos`;
    const body: Record<string, unknown> = {
      model: args.model,
      prompt: args.prompt,
    };
    if (args.openaiVideo?.seconds) body.seconds = args.openaiVideo.seconds;
    if (args.openaiVideo?.size) body.size = args.openaiVideo.size;
    if (args.openaiVideo?.imageUrl) body.image_url = args.openaiVideo.imageUrl;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(
          `رفض المزوّد المفتاح (${res.status}) — ${await errMsg(res)}`
        );
      }
      const json = (await res.json().catch(() => null)) as unknown;
      const urls = res.ok ? extractUrls(json) : [];
      if (urls.length > 0) {
        return { kind: "openai-video", taskId: null, prefix: oaiPrefix, immediateUrls: urls };
      }
      const id =
        json && typeof json === "object"
          ? (() => {
              const o = json as Record<string, unknown>;
              for (const field of ["id", "job_id", "video_id", "task_id"]) {
                if (typeof o[field] === "string" && (o[field] as string).trim())
                  return (o[field] as string).trim();
              }
              const data = o.data;
              if (data && typeof data === "object") {
                const d = data as Record<string, unknown>;
                for (const field of ["id", "job_id", "video_id", "task_id"]) {
                  if (typeof d[field] === "string" && (d[field] as string).trim())
                    return (d[field] as string).trim();
                }
              }
              return null;
            })()
          : null;
      if (id) return { kind: "openai-video", taskId: id, prefix: oaiPrefix, immediateUrls: [] };
      const msg = res.ok ? "لم يُرجع المزوّد معرّف مهمة" : await errMsg(res);
      tried.push(`${endpoint}: ${msg}`);
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      tried.push(
        `${endpoint}: ${err instanceof Error ? err.message : "فشل الاتصال"}`
      );
    }
  }

  throw new Error(
    `تعذر إنشاء مهمة التوليد لدى المزوّد (${args.cfg.baseUrl}) — ${tried.slice(0, 4).join(" | ")}`
  );
}

/* ------------------------- الاستعلام عن الحالة ------------------------- */

/** حالة مهمة واجهة المهام عبر تجربة مرشّحات recordInfo (يدعم المهام القديمة) */
async function getJobsState(
  taskId: string,
  cfg: ProviderConfig,
  knownPrefix?: string
): Promise<RemoteTaskState> {
  const key = cfg.apiKey?.trim();
  if (!key) throw new Error("لا يوجد مفتاح API مضبوط للاستعلام عن المهمة");
  const headers = providerHeaders(key);
  const prefixes = knownPrefix
    ? uniq([knownPrefix, ...jobsPrefixes(cfg.baseUrl)])
    : jobsPrefixes(cfg.baseUrl);

  let lastMsg = "";
  for (const prefix of prefixes) {
    const endpoint = `${prefix}/recordInfo?taskId=${encodeURIComponent(taskId)}`;
    try {
      const res = await fetch(endpoint, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(
          `رفض المزوّد المفتاح (${res.status}) — ${await errMsg(res)}`
        );
      }
      const json = (await res.json().catch(() => null)) as unknown;
      if (
        json &&
        typeof json === "object" &&
        ((json as Record<string, unknown>).data != null ||
          (typeof (json as Record<string, unknown>).code === "number" &&
            (json as Record<string, unknown>).code === 200))
      ) {
        const obj = json as Record<string, unknown>;
        if ((obj.data ?? null) != null) return parseJobsRecord(json);
        lastMsg = `HTTP ${res.status}`;
        continue;
      }
      lastMsg = json && typeof json === "object" && "msg" in json
        ? String((json as Record<string, unknown>).msg)
        : `HTTP ${res.status}`;
    } catch (err) {
      if (err instanceof ProviderAuthError) throw err;
      lastMsg = err instanceof Error ? err.message : "فشل الاتصال";
    }
  }
  throw new Error(`تعذر الاستعلام عن حالة المهمة: ${lastMsg || "لا رد"}`);
}

const OAI_DONE = /completed|succeeded|success|complete|done/i;
const OAI_FAILED = /failed|error|cancelled|canceled|moderat/i;
const OAI_RUNNING = /in_progress|processing|running|generating|uploading/i;

/** حالة مهمة الفيديو في الواجهة المتوافقة مع OpenAI (نمط Sora) */
async function getOpenaiVideoState(
  taskId: string,
  prefix: string,
  cfg: ProviderConfig,
  genId: string
): Promise<RemoteTaskState> {
  const key = cfg.apiKey?.trim();
  if (!key) throw new Error("لا يوجد مفتاح API مضبوط للاستعلام عن المهمة");
  const res = await fetch(
    `${prefix}/videos/${encodeURIComponent(taskId)}`,
    {
      headers: providerHeaders(key),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (res.status === 401 || res.status === 403) {
    throw new ProviderAuthError(
      `رفض المزوّد المفتاح (${res.status}) — ${await errMsg(res)}`
    );
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error(`تعذر الاستعلام عن حالة المهمة: HTTP ${res.status}`);
  }
  const status = String(
    (json as Record<string, unknown>).status ?? ""
  ).trim();
  const urls = extractUrls(json);

  if (OAI_FAILED.test(status)) {
    const o = json as Record<string, unknown>;
    const errObj = o.error;
    const failMsg =
      errObj && typeof errObj === "object"
        ? String((errObj as Record<string, unknown>).message ?? "فشل التوليد")
        : typeof errObj === "string"
          ? errObj
          : "فشل التوليد";
    return { state: "fail", resultUrls: [], failMsg };
  }
  if (OAI_DONE.test(status)) {
    if (urls.length > 0) return { state: "success", resultUrls: urls, failMsg: null };
    // لا رابط عام — يُخدم المحتوى الثنائي عبر بروكسي الوسائط
    return { state: "success", resultUrls: [`/api/media/${genId}`], failMsg: null };
  }
  if (OAI_RUNNING.test(status))
    return { state: "generating", resultUrls: [], failMsg: null };
  return { state: "waiting", resultUrls: [], failMsg: null };
}

/** حالة مهمة صور متزامنة مؤجلة (نادرة — رد بمعرّف دون نتائج) */
async function getOpenaiImageState(
  taskId: string,
  prefix: string,
  cfg: ProviderConfig
): Promise<RemoteTaskState> {
  const key = cfg.apiKey?.trim();
  if (!key) throw new Error("لا يوجد مفتاح API مضبوط للاستعلام عن المهمة");
  const res = await fetch(
    `${prefix}/images/generations/${encodeURIComponent(taskId)}`,
    {
      headers: providerHeaders(key),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!res.ok) {
    return {
      state: "fail",
      resultUrls: [],
      failMsg: `المزوّد لا يوفر استعلامًا لمهمة الصور (HTTP ${res.status})`,
    };
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const urls = json ? imageResults(json) : [];
  if (urls.length > 0)
    return { state: "success", resultUrls: urls, failMsg: null };
  return { state: "waiting", resultUrls: [], failMsg: null };
}

/**
 * الاستعلام عن حالة أي مهمة وفق لقطة المزوّد المحفوظة معها —
 * لقطة ناقصة (مهام قديمة) تعني افتراض واجهة المهام مع اشتقاق المرشّحات.
 */
export async function getRemoteTaskState(
  taskId: string,
  snapshot: ProviderSnapshot | null | undefined,
  cfg: ProviderConfig,
  genId: string
): Promise<RemoteTaskState> {
  const kind = snapshot?.kind ?? "jobs";
  if (kind === "jobs") {
    return getJobsState(taskId, cfg, snapshot?.prefix);
  }
  const prefix = snapshot?.prefix ?? openaiPrefixes(cfg.baseUrl)[0]!;
  if (kind === "openai-video")
    return getOpenaiVideoState(taskId, prefix, cfg, genId);
  return getOpenaiImageState(taskId, prefix, cfg);
}

/** نقطة نهاية محتوى الفيديو للبروكسي (نمط Sora: /videos/{id}/content) */
export function mediaContentEndpoints(
  baseUrl: string,
  taskId: string,
  knownPrefix?: string
): string[] {
  const prefixes = knownPrefix
    ? uniq([knownPrefix, ...openaiPrefixes(baseUrl)])
    : openaiPrefixes(baseUrl);
  return prefixes.map(
    (p) => `${p}/videos/${encodeURIComponent(taskId)}/content`
  );
}
