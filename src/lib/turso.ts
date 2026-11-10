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
 * - محليًا بدون متغيرات بيئة يتم الرجوع إلى ملف SQLite محلي.
 */
export const turso = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./db/local.db",
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
  };
}

export async function insertGeneration(gen: Generation): Promise<void> {
  await turso.execute({
    sql: `INSERT INTO generations (id, task_id, type, model, prompt, params, status, result_urls, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
