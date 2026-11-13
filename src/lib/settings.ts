import { IMAGE_MODEL, VIDEO_MODEL } from "@/lib/kie";
import {
  deleteSetting,
  ensureSchema,
  getSettingsMap,
  setSetting,
} from "@/lib/turso";

/**
 * إعدادات المزوّد (رابط الخدمة + المفتاح + النماذج) —
 * تُقرأ من قاعدة البيانات مع الرجوع إلى متغيرات البيئة عند غياب القيمة.
 * تُستخدم في كل مسارات التوليد (الواجهة، MCP، الأوتوبايلوت، ChatGPT Actions).
 */

export const DEFAULT_BASE_URL = "https://api.kie.ai";

const KEY_BASE_URL = "provider_base_url";
const KEY_API_KEY = "provider_api_key";
const KEY_IMAGE_MODEL = "image_model";
const KEY_VIDEO_MODEL = "video_model";

export type ApiKeySource = "custom" | "env" | "none";

export interface ProviderSettings {
  /** رابط خدمة التووليد (افتراضيًا https://api.kie.ai) */
  baseUrl: string;
  /** المفتاح الفعلي المستخدم (مخصص أو من البيئة) — لا يُعرض كاملًا للعميل أبدًا */
  apiKey: string | null;
  apiKeySource: ApiKeySource;
  /** true إذا كان المفتاح محفوظًا في قاعدة البيانات (وليس من متغيرات البيئة) */
  hasCustomKey: boolean;
  imageModel: string;
  videoModel: string;
  imageModelCustom: boolean;
  videoModelCustom: boolean;
}

/* ------- ذاكرة تخزين مؤقت قصيرة (3 ثوانٍ) لتخفيف الاستعلامات أثناء الاستقصاء ------- */

let cache: { value: ProviderSettings; at: number } | null = null;
const CACHE_MS = 3000;

export function invalidateSettingsCache(): void {
  cache = null;
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

function envImageModel(): string {
  return process.env.KIE_IMAGE_MODEL ?? IMAGE_MODEL;
}

function envVideoModel(): string {
  return process.env.KIE_VIDEO_MODEL ?? VIDEO_MODEL;
}

function buildFromMap(map: Record<string, string>): ProviderSettings {
  const customKey = map[KEY_API_KEY] ?? null;
  const envKey = process.env.KIE_API_KEY?.trim() || null;
  const apiKey = customKey ?? envKey;

  return {
    baseUrl: map[KEY_BASE_URL]?.trim() || DEFAULT_BASE_URL,
    apiKey: apiKey && apiKey.trim() ? apiKey.trim() : null,
    apiKeySource: customKey ? "custom" : envKey ? "env" : "none",
    hasCustomKey: Boolean(customKey),
    imageModel: map[KEY_IMAGE_MODEL]?.trim() || envImageModel(),
    videoModel: map[KEY_VIDEO_MODEL]?.trim() || envVideoModel(),
    imageModelCustom: Boolean(map[KEY_IMAGE_MODEL]?.trim()),
    videoModelCustom: Boolean(map[KEY_VIDEO_MODEL]?.trim()),
  };
}

/** قراءة الإعدادات الفعالة (قاعدة البيانات ثم البيئة ثم الافتراضي) */
export async function getProviderSettings(): Promise<ProviderSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  await ensureSchema();
  const map = await getSettingsMap();
  const value = buildFromMap(map);
  cache = { value, at: Date.now() };
  return value;
}

export interface SaveSettingsPatch {
  baseUrl?: string;
  /** مفتاح جديد؛ سلسلة فارغة أو null تعني عدم التغيير */
  apiKey?: string | null;
  /** استبدال المفتاح المخصص بالمفتاح من متغيرات البيئة */
  clearApiKey?: boolean;
  imageModel?: string;
  videoModel?: string;
}

/** حفظ (أو تحديث جزئي) لإعدادات المزوّد وإبطال الكاش */
export async function saveProviderSettings(
  patch: SaveSettingsPatch
): Promise<ProviderSettings> {
  await ensureSchema();
  if (patch.baseUrl !== undefined) {
    const url = normalizeBaseUrl(patch.baseUrl);
    await setSetting(KEY_BASE_URL, url);
  }
  if (patch.clearApiKey) {
    await deleteSetting(KEY_API_KEY);
  } else if (patch.apiKey != null && patch.apiKey.trim().length > 0) {
    await setSetting(KEY_API_KEY, patch.apiKey.trim());
  }
  if (patch.imageModel !== undefined && patch.imageModel.trim()) {
    await setSetting(KEY_IMAGE_MODEL, patch.imageModel.trim());
  }
  if (patch.videoModel !== undefined && patch.videoModel.trim()) {
    await setSetting(KEY_VIDEO_MODEL, patch.videoModel.trim());
  }
  invalidateSettingsCache();
  return getProviderSettings();
}

/** استعادة الافتراضي: حذف كل الإعدادات المخصصة (يرجع إلى متغيرات البيئة) */
export async function resetProviderSettings(): Promise<ProviderSettings> {
  await ensureSchema();
  for (const key of [
    KEY_BASE_URL,
    KEY_API_KEY,
    KEY_IMAGE_MODEL,
    KEY_VIDEO_MODEL,
  ]) {
    await deleteSetting(key);
  }
  invalidateSettingsCache();
  return getProviderSettings();
}

/** تطبيع رابط الخدمة: إزالة الشرطة المائلة النهائية ومسارات المهام الزائدة */
export function normalizeBaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  // لو لصق المستخدم رابطًا يتضمن مسار المهام نقتطف الجزء الأساسي
  s = s.replace(/\/api\/v1\/jobs.*$/i, "").replace(/\/api\/v1$/i, "");
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    throw new Error("رابط الخدمة غير صالح — مثال صحيح: https://api.kie.ai");
  }
}

/** شكل آمن للعرض في الواجهة (بدون المفتاح الكامل) */
export interface PublicProviderSettings {
  baseUrl: string;
  apiKeyMasked: string | null;
  apiKeySource: ApiKeySource;
  hasCustomKey: boolean;
  imageModel: string;
  videoModel: string;
  imageModelCustom: boolean;
  videoModelCustom: boolean;
  envImageModel: string;
  envVideoModel: string;
}

export function toPublicSettings(s: ProviderSettings): PublicProviderSettings {
  return {
    baseUrl: s.baseUrl,
    apiKeyMasked: s.apiKey ? maskKey(s.apiKey) : null,
    apiKeySource: s.apiKeySource,
    hasCustomKey: s.hasCustomKey,
    imageModel: s.imageModel,
    videoModel: s.videoModel,
    imageModelCustom: s.imageModelCustom,
    videoModelCustom: s.videoModelCustom,
    envImageModel: envImageModel(),
    envVideoModel: envVideoModel(),
  };
}
