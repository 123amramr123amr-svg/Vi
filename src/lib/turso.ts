import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import {
  type Generation,
  type GenerationParams,
  type GenerationType,
  type GenerationStatus,
} from "./types";

/**
 * عميل Turso (libSQL).
 * - في الإنتاج / Vercel: يجب تعريف TURSO_DATABASE_URL و TURSO_AUTH_TOKEN.
 * - محليًا بدون متغيرات بيئة يتم الرجوع إلى ملف SQLite محلي
 *   (يُنشأ المجلد تلقائيًا عند الحاجة).
 */
const DB_URL = process.env.TURSO_DATABASE_URL ?? "file:./db/local.db";

if (DB_URL.startsWith("file:")) {
  // @libsql/client لا ينشئ المجلد الأب تلقائيًا — نضمن وجوده
  const path = DB_URL.slice("file:".length);
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || ".";
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* المجلد موجود مسبقًا */
  }
}

export const turso = createClient({
  url: DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let schemaPromise: Promise<void> | null = null;

/** إنشاء الجداول مرة واحدة لكل نسخة خادم (آمن استدعاؤه في كل طلب). */
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS generations (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          type TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          result_urls TEXT NOT NULL DEFAULT '[]',
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      await turso.execute(
        "CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations (created_at DESC)"
      );
      // ترقية قاعدة قائمة: أعمدة النشر في المعرض العام + أعمدة سلسلة تكملة الفيديو
      for (const stmt of [
        "ALTER TABLE generations ADD COLUMN published INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE generations ADD COLUMN published_at INTEGER",
        "ALTER TABLE generations ADD COLUMN parent_id TEXT",
        "ALTER TABLE generations ADD COLUMN part_number INTEGER",
      ]) {
        try {
          await turso.execute(stmt);
        } catch {
          /* العمود موجود مسبقًا */
        }
      }
      await turso.execute(
        "CREATE INDEX IF NOT EXISTS idx_generations_published ON generations (published, created_at DESC)"
      );
      await turso.execute(
        "CREATE INDEX IF NOT EXISTS idx_generations_parent ON generations (parent_id, part_number)"
      );
      // الصور المرفوعة (تُخدم على رابط عام ليستخدمها مزوّد التوليد في image-to-video)
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          data BLOB NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      await turso.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at DESC)"
      );
      // إعدادات التطبيق (المزوّد/المفتاح/النماذج) — مخزن مفتاح/قيمة
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

type Row = Record<string, unknown>;

function rowToGeneration(row: Row): Generation {
  let params: GenerationParams = {};
  try {
    params = JSON.parse((row.params as string) ?? "{}");
  } catch {
    params = {};
  }
  let urls: string[] = [];
  try {
    const parsed = JSON.parse((row.result_urls as string) ?? "[]");
    if (Array.isArray(parsed)) urls = parsed.filter((u) => typeof u === "string");
  } catch {
    urls = [];
  }
  return {
    id: row.id as string,
    taskId: (row.task_id as string) || null,
    type: row.type as GenerationType,
    model: row.model as string,
    prompt: row.prompt as string,
    params,
    status: row.status as GenerationStatus,
    resultUrls: urls,
    error: (row.error as string) || null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    published: Number(row.published ?? 0) === 1,
    publishedAt: row.published_at ? Number(row.published_at) : null,
    parentId: (row.parent_id as string) || null,
    partNumber: row.part_number == null ? null : Number(row.part_number),
  };
}

export async function insertGeneration(gen: Generation): Promise<void> {
  await turso.execute({
    sql: `INSERT INTO generations (id, task_id, type, model, prompt, params, status, result_urls, error, created_at, updated_at, published, published_at, parent_id, part_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      gen.id,
      gen.taskId,
      gen.type,
      gen.model,
      gen.prompt,
      JSON.stringify(gen.params),
      gen.status,
      JSON.stringify(gen.resultUrls),
      gen.error,
      gen.createdAt,
      gen.updatedAt,
      gen.published ? 1 : 0,
      gen.publishedAt,
      gen.parentId,
      gen.partNumber,
    ],
  });
}

export async function getGeneration(id: string): Promise<Generation | null> {
  const rs = await turso.execute({
    sql: "SELECT * FROM generations WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (rs.rows.length === 0) return null;
  return rowToGeneration(rs.rows[0] as unknown as Row);
}

export async function listGenerations(limit = 60): Promise<Generation[]> {
  const rs = await turso.execute({
    sql: "SELECT * FROM generations ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return rs.rows.map((r) => rowToGeneration(r as unknown as Row));
}

export async function updateGeneration(
  id: string,
  fields: {
    status?: GenerationStatus;
    taskId?: string;
    resultUrls?: string[];
    error?: string | null;
    published?: boolean;
    publishedAt?: number | null;
    partNumber?: number | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (fields.status !== undefined) {
    sets.push("status = ?");
    args.push(fields.status);
  }
  if (fields.taskId !== undefined) {
    sets.push("task_id = ?");
    args.push(fields.taskId);
  }
  if (fields.resultUrls !== undefined) {
    sets.push("result_urls = ?");
    args.push(JSON.stringify(fields.resultUrls));
  }
  if (fields.error !== undefined) {
    sets.push("error = ?");
    args.push(fields.error);
  }
  if (fields.published !== undefined) {
    sets.push("published = ?");
    args.push(fields.published ? 1 : 0);
  }
  if (fields.publishedAt !== undefined) {
    sets.push("published_at = ?");
    args.push(fields.publishedAt);
  }
  if (fields.partNumber !== undefined) {
    sets.push("part_number = ?");
    args.push(fields.partNumber);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(Date.now());
  args.push(id);
  await turso.execute({
    sql: `UPDATE generations SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deleteGeneration(id: string): Promise<void> {
  await turso.execute({
    sql: "DELETE FROM generations WHERE id = ?",
    args: [id],
  });
}

/* ---------- النشر في المعرض العام ---------- */

/** الأعمال المنشورة (الظاهرة للجميع في /gallery) */
export async function listPublished(limit = 60): Promise<Generation[]> {
  const rs = await turso.execute({
    sql: "SELECT * FROM generations WHERE published = 1 AND status = 'success' ORDER BY published_at DESC LIMIT ?",
    args: [limit],
  });
  return rs.rows.map((r) => rowToGeneration(r as unknown as Row));
}

/** مهام الأوتوبايلوت قيد التنفيذ (params تحتوي "autopilot":true) */
export async function listActiveAutopilot(limit = 5): Promise<Generation[]> {
  const rs = await turso.execute({
    sql: `SELECT * FROM generations
          WHERE params LIKE '%"autopilot":true%'
            AND status IN ('pending','waiting','queuing','generating')
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => rowToGeneration(r as unknown as Row));
}

/** إجمالي مهام الأوتوبايلوت المنشأة (يُستخدم للدوران على قائمة المواضيع) */
export async function countAutopilot(): Promise<number> {
  const rs = await turso.execute({
    sql: `SELECT COUNT(*) AS c FROM generations WHERE params LIKE '%"autopilot":true%'`,
  });
  const row = rs.rows[0] as unknown as Row | undefined;
  return Number(row?.c ?? 0);
}

/* ---------- الصور المرفوعة (لتغذية نموذج الفيديو بها) ---------- */

export interface UploadRow {
  id: string;
  mime: string;
  size: number;
  data: Uint8Array;
  createdAt: number;
}

export async function insertUpload(up: {
  id: string;
  mime: string;
  data: Uint8Array;
}): Promise<void> {
  await turso.execute({
    sql: "INSERT INTO uploads (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [up.id, up.mime, up.data.byteLength, up.data, Date.now()],
  });
}

export async function getUpload(id: string): Promise<UploadRow | null> {
  const rs = await turso.execute({
    sql: "SELECT * FROM uploads WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (rs.rows.length === 0) return null;
  const row = rs.rows[0] as unknown as Row;
  return {
    id: row.id as string,
    mime: row.mime as string,
    size: Number(row.size),
    data: row.data as unknown as Uint8Array,
    createdAt: Number(row.created_at),
  };
}

/* ---------- رسائل المحادثة (شات جي بي تي) ---------- */

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export async function insertChatMessage(
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await turso.execute({
    sql: "INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)",
    args: [crypto.randomUUID(), role, content, Date.now()],
  });
}

export async function listChatMessages(limit = 50): Promise<ChatRow[]> {
  const rs = await turso.execute({
    sql: "SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });
  return rs.rows
    .map((r) => r as unknown as Row)
    .map((r) => ({
      id: r.id as string,
      role: r.role as "user" | "assistant",
      content: r.content as string,
      createdAt: Number(r.created_at),
    }))
    .reverse();
}

export async function clearChatMessages(): Promise<void> {
  await turso.execute("DELETE FROM chat_messages");
}

/* ---------- إعدادات التطبيق (مخزن مفتاح/قيمة) ---------- */

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rs = await turso.execute("SELECT key, value FROM settings");
  const map: Record<string, string> = {};
  for (const r of rs.rows) {
    const row = r as unknown as Row;
    const key = row.key as string;
    const value = row.value as string;
    if (typeof key === "string" && typeof value === "string") map[key] = value;
  }
  return map;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await turso.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, Date.now()],
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await turso.execute({
    sql: "DELETE FROM settings WHERE key = ?",
    args: [key],
  });
}
