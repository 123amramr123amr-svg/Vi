/**
 * خادم مزوّد وهمي محلي لاختبار دعم "أي رابط لأي مفتاح" — بلا أي استدعاء حقيقي.
 *
 * يخدم جبلين بنفس المنفذ:
 * - نمط OpenAI:  http://127.0.0.1:PORT/oai/v1      (models + images/generations + videos)
 * - نمط kie:     http://127.0.0.1:PORT/kieapi      (models + api/v1/jobs/createTask + recordInfo)
 *
 * التشغيل: bun scripts/mock_provider.mjs [PORT]
 * المفتاح الصحيح: mock-key-123  (أي مفتاح آخر → 401)
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 9091);
const KEY = "mock-key-123";
const VIDEO_BYTES = Buffer.from("MOCK-VIDEO-BYTES-0123456789");
const IMG_BYTES = Buffer.from("MOCK-IMAGE-BYTES-0123456789");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "assets");

/** ملفات MP4 حقيقية صغيرة (مولّدة بـ ffmpeg) لاختبار دمج الفيديوهات فعليًا */
function realAsset(name, fallback) {
  const p = path.join(ASSETS, name);
  return existsSync(p) ? readFileSync(p) : fallback;
}

const state = {
  videoCreates: 0,
  videoPolls: new Map(),
  jobs: new Map(),
  jobsAsset: new Map(),
  jobSeq: 0,
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendBytes(res, code, buf, mime) {
  res.writeHead(code, {
    "Content-Type": mime,
    "Content-Length": buf.byteLength,
  });
  res.end(buf);
}

function authOk(req) {
  const bearer = (req.headers["authorization"] ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return bearer === KEY || req.headers["x-api-key"] === KEY;
}

const unauthorized = (res) =>
  sendJson(res, 401, { error: { message: "invalid api key" } });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  console.log(`[mock] ${req.method} ${p}`);

  /* ---------- أصول ثابتة ---------- */
  if (p === "/assets/image.png")
    return sendBytes(res, 200, realAsset("mock-image.png", IMG_BYTES), "image/png");
  if (p === "/assets/video.mp4" || p === "/assets/part1.mp4")
    return sendBytes(res, 200, realAsset("mock-part1.mp4", VIDEO_BYTES), "video/mp4");
  if (p === "/assets/part2.mp4")
    return sendBytes(res, 200, realAsset("mock-part2.mp4", VIDEO_BYTES), "video/mp4");

  /* ---------- جبل نمط OpenAI: /oai/v1 ---------- */
  if (p === "/oai/v1/models") {
    if (!authOk(req)) return unauthorized(res);
    return sendJson(res, 200, {
      object: "list",
      data: [
        { id: "mock-chat-llm", object: "model" },
        { id: "oai-mock-image", object: "model" },
        { id: "oai-mock-video", object: "model" },
      ],
    });
  }

  if (p === "/oai/v1/images/generations" && req.method === "POST") {
    if (!authOk(req)) return unauthorized(res);
    const body = await readBody(req);
    if (body.model !== "oai-mock-image")
      return sendJson(res, 400, {
        error: { message: `unknown model: ${body.model}` },
      });
    return sendJson(res, 200, {
      created: Date.now(),
      data: [{ url: `http://127.0.0.1:${PORT}/assets/image.png` }],
    });
  }

  if (p === "/oai/v1/videos" && req.method === "POST") {
    if (!authOk(req)) return unauthorized(res);
    const body = await readBody(req);
    if (body.model !== "oai-mock-video")
      return sendJson(res, 400, {
        error: { message: `unknown model: ${body.model}` },
      });
    state.videoCreates += 1;
    const id = `vid_${state.videoCreates}`;
    // الزوجي: مهمة بلا رابط عام (محتوى فقط عبر /content) — لاختبار بروكسي الوسائط
    // الفردي: مهمة عادية تصبح مكتملة برابط عام بعد 3 استعلامات
    if (state.videoCreates % 2 === 0) {
      return sendJson(res, 200, { id, status: "queued" });
    }
    state.videoPolls.set(id, 0);
    return sendJson(res, 200, { id, status: "queued" });
  }

  const mVideo = p.match(/^\/oai\/v1\/videos\/(vid_\d+)$/);
  if (mVideo && req.method === "GET") {
    if (!authOk(req)) return unauthorized(res);
    const id = mVideo[1];
    const n = Number(id.split("_")[1]);
    if (n % 2 === 0) {
      // فيديو بلا رابط عام — المحتوى فقط عبر /content (يختبر بروكسي الوسائط)
      return sendJson(res, 200, { id, status: "completed", has_content: true });
    }
    const count = (state.videoPolls.get(id) ?? 0) + 1;
    state.videoPolls.set(id, count);
    if (count < 3)
      return sendJson(res, 200, {
        id,
        status: count === 1 ? "queued" : "in_progress",
      });
    return sendJson(res, 200, {
      id,
      status: "completed",
      video_url: `http://127.0.0.1:${PORT}/assets/video.mp4`,
    });
  }

  const mContent = p.match(/^\/oai\/v1\/videos\/(vid_\d+)\/content$/);
  if (mContent && req.method === "GET") {
    if (!authOk(req)) return unauthorized(res);
    return sendBytes(res, 200, VIDEO_BYTES, "video/mp4");
  }

  /* ---------- جبل نمط kie: /kieapi ---------- */
  if (p === "/kieapi/v1/models") {
    if (!authOk(req)) return unauthorized(res);
    return sendJson(res, 200, {
      code: 200,
      data: [{ model: "kie-mock-image" }, { model: "kie-mock-video" }],
    });
  }

  if (p === "/kieapi/api/v1/jobs/createTask" && req.method === "POST") {
    if (!authOk(req)) return unauthorized(res);
    const body = await readBody(req);
    if (!body.model || typeof body.input !== "object")
      return sendJson(res, 400, { code: 400, msg: "model and input required" });
    /* محاكاة نموذج معطل لدى المزوّد — لاختبار سلسلة النماذج البديلة */
    if (body.model === "broken-video-model")
      return sendJson(res, 200, { code: 500, msg: "Internal error" });
    state.jobSeq += 1;
    const taskId = `job_${state.jobSeq}`;
    state.jobs.set(taskId, 0);
    /* مهام image-to-video تعيد مقطعًا مختلفًا قليلًا (الجزء 2) لتمييز الدمج */
    const hasImages = Array.isArray(body.input?.image_urls) && body.input.image_urls.length > 0;
    state.jobsAsset.set(taskId, hasImages ? "/assets/part2.mp4" : "/assets/video.mp4");
    return sendJson(res, 200, {
      code: 200,
      msg: "success",
      data: { taskId },
    });
  }

  if (p === "/kieapi/api/v1/jobs/recordInfo" && req.method === "GET") {
    if (!authOk(req)) return unauthorized(res);
    const taskId = url.searchParams.get("taskId") ?? "";
    if (!state.jobs.has(taskId))
      return sendJson(res, 200, { code: 404, msg: "task not found" });
    const n = (state.jobs.get(taskId) ?? 0) + 1;
    state.jobs.set(taskId, n);
    if (n === 1)
      return sendJson(res, 200, { code: 200, data: { taskId, state: "waiting" } });
    if (n === 2)
      return sendJson(res, 200, { code: 200, data: { taskId, state: "generating" } });
    const asset = state.jobsAsset.get(taskId) ?? "/assets/video.mp4";
    return sendJson(res, 200, {
      code: 200,
      data: {
        taskId,
        state: "success",
        resultJson: JSON.stringify({
          resultUrls: [`http://127.0.0.1:${PORT}${asset}`],
        }),
      },
    });
  }

  /* المزوّد لا يعرف المسار — 404 كما يفعل أي مزوّد حقيقي */
  sendJson(res, 404, { error: { message: `not found: ${req.method} ${p}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] provider listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock]  - OpenAI-style base: http://127.0.0.1:${PORT}/oai/v1`);
  console.log(`[mock]  - kie-style base:    http://127.0.0.1:${PORT}/kieapi`);
  console.log(`[mock]  - api key: ${KEY}`);
});
