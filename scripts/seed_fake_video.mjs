/**
 * إدخال فيديو وهمي مكتمل في قاعدة البيانات المحلية لأغراض الفحص البصري فقط
 * (لا يتصل بأي مزوّد — مجرد صف في قاعدة البيانات).
 * الاستخدام: bun scripts/seed_fake_video.mjs
 */
import { createClient } from "@libsql/client";

const db = createClient({ url: "file:./db/local.db" });

const id = crypto.randomUUID();
const now = Date.now();

await db.execute({
  sql: `INSERT INTO generations (id, task_id, type, model, prompt, params, status, result_urls, error, created_at, updated_at, published, published_at, parent_id, part_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    id,
    "fake_task_seed_0001",
    "video",
    "grok-imagine-video-1-5-preview",
    "Cinematic slow drone shot flying over a futuristic neon city at night — الجزء الأول من فيديو تجريبي لفحص زر التكملة",
    JSON.stringify({ aspectRatio: "16:9", resolution: "720p", duration: 15, enableAudio: true }),
    "success",
    JSON.stringify(["https://example.com/fake-video.mp4"]),
    null,
    now - 60000,
    now,
    0,
    null,
    null,
    1,
  ],
});

console.log(id);
