import { NextRequest, NextResponse } from "next/server";
import { IMAGE_ASPECT_RATIOS, VIDEO_ASPECT_RATIOS } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/openapi.json — مخطط OpenAPI 3.1 جاهز للاستيراد في ChatGPT
 * كـ Custom GPT Action بحيث يتحكم شات جي بي تي في التطبيق بالكامل
 * (إنشاء توليد، متابعة الحالة، عرض السجل، الحذف).
 *
 * رابط الخادم يُبنى ديناميكيًا من ترويسات الطلب ليعمل تلقائيًا
 * على localhost وعلى دومين Vercel بعد النشر دون أي تعديل.
 */

function getBaseUrl(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "localhost:3000";
  const protoHeader = req.headers.get("x-forwarded-proto");
  const proto = protoHeader
    ? protoHeader.split(",")[0]!.trim()
    : host.includes("localhost") || host.startsWith("127.")
      ? "http"
      : "https";
  return `${proto}://${host}`;
}

const generationSchema = {
  type: "object",
  description: "A generation task stored in the Vi studio database.",
  properties: {
    id: { type: "string", description: "Unique generation id (UUID). Pass it to getGeneration." },
    taskId: { type: ["string", "null"], description: "Provider task id (internal)." },
    type: { type: "string", enum: ["image", "video"] },
    model: { type: "string", description: "AI model used for this task." },
    prompt: { type: "string" },
    params: {
      type: "object",
      description: "Chosen options: aspectRatio, resolution, duration (video), enableAudio (video).",
    },
    status: {
      type: "string",
      enum: ["pending", "waiting", "queuing", "generating", "success", "fail"],
      description: "Poll while status is pending/waiting/queuing/generating. Terminal states: success, fail.",
    },
    resultUrls: {
      type: "array",
      items: { type: "string" },
      description: "Direct links to the generated image/video files. Empty until status is success.",
    },
    error: { type: ["string", "null"], description: "Failure reason (Arabic) when status is fail." },
    createdAt: { type: "number", description: "Creation time as epoch milliseconds." },
    updatedAt: { type: "number", description: "Last update time as epoch milliseconds." },
    published: { type: "boolean", description: "True when the work is visible in the public gallery at /gallery." },
    publishedAt: { type: ["number", "null"], description: "Publish time as epoch milliseconds." },
  },
  required: ["id", "type", "model", "prompt", "status", "resultUrls"],
};

const statusEnum = ["pending", "waiting", "queuing", "generating", "success", "fail"];

export async function GET(req: NextRequest) {
  const baseUrl = getBaseUrl(req);

  const schema = {
    openapi: "3.1.0",
    info: {
      title: "Vi AI Studio",
      description:
        "Control the Vi AI Studio app end to end: create AI image and video generation tasks, poll them until finished, publish finished works to the public gallery (/gallery), run the autopilot that generates and publishes new videos automatically, and browse or delete the history. Typical flow: call createGeneration (or runAutopilot), then keep calling getGeneration (use wait=8) until status is success or fail, then call publishGeneration and share the resultUrls links with the user.",
      version: "1.1.0",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/generate": {
        post: {
          operationId: "createGeneration",
          summary: "Create a new AI image or video generation task",
          description:
            "Starts generating an image or a video from a text prompt. Returns { id, taskId, status }. After this, poll getGeneration with the returned id until status is success or fail. Prompt should be a rich visual description (subject, style, lighting, camera angle, mood); English prompts give the best results.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["image", "video"],
                      description: "What to generate.",
                    },
                    prompt: {
                      type: "string",
                      description:
                        "Detailed visual description of the content. Max 20000 chars for images, 4096 for videos.",
                    },
                    aspectRatio: {
                      type: "string",
                      description: `Aspect ratio. For images one of: ${IMAGE_ASPECT_RATIOS.join(", ")}. For videos one of: ${VIDEO_ASPECT_RATIOS.join(", ")}. Defaults to auto.`,
                    },
                    resolution: {
                      type: "string",
                      description:
                        "Image: 1K (default), 2K or 4K. Video: 480p, 720p (default) or 1080p.",
                    },
                    duration: {
                      type: "integer",
                      description: "Video only: clip length in seconds, 1-15. Default 8.",
                    },
                    enableAudio: {
                      type: "boolean",
                      description: "Video only: generate audio track. Default true.",
                    },
                  },
                  required: ["type", "prompt"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Task created. Poll getGeneration with the returned id.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      taskId: { type: "string" },
                      status: { type: "string", enum: statusEnum },
                    },
                    required: ["id", "status"],
                  },
                },
              },
            },
            "400": {
              description: "Invalid input (missing prompt or bad values).",
              content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
            },
            "502": {
              description: "Provider failed to accept the task.",
              content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
            },
          },
        },
      },
      "/api/generations/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Generation id returned by createGeneration.",
          },
        ],
        get: {
          operationId: "getGeneration",
          summary: "Check generation status and get result links",
          description:
            "Returns one generation with its current status. If wait is set, the server keeps polling internally for up to that many seconds before answering, which reduces the number of calls you need. Keep calling until status is success or fail. On success show the resultUrls links to the user; on fail explain the error field.",
          parameters: [
            {
              name: "wait",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0, maximum: 8, default: 0 },
              description: "Seconds to wait server-side (max 8). Always pass wait=8 to reduce polling calls.",
            },
          ],
          responses: {
            "200": {
              description: "Current generation state.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { item: generationSchema },
                    required: ["item"],
                  },
                },
              },
            },
            "404": {
              description: "Generation not found.",
              content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
            },
          },
        },
        delete: {
          operationId: "deleteGeneration",
          summary: "Delete a generation from history",
          description: "Permanently removes one generation by id (also removes it from the public gallery if it was published). Confirm with the user before calling.",
          responses: {
            "200": {
              description: "Deleted.",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
          },
        },
      },
      "/api/generations/{id}/publish": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Generation id returned by createGeneration.",
          },
        ],
        put: {
          operationId: "publishGeneration",
          summary: "Publish a finished work to the public gallery",
          description:
            "Makes a successfully finished generation publicly visible on the site gallery (/gallery). Only works when status is success. Call it after getGeneration reports success so the work appears on the user's site.",
          responses: {
            "200": {
              description: "Published. Returns the updated item with published=true.",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
            "400": {
              description: "Generation is not finished successfully yet.",
              content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
            },
          },
        },
        delete: {
          operationId: "unpublishGeneration",
          summary: "Unpublish a work from the public gallery",
          description: "Hides the work from the public gallery (it stays in the private history). Confirm with the user before calling.",
          responses: {
            "200": {
              description: "Unpublished.",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
          },
        },
      },
      "/api/published": {
        get: {
          operationId: "listPublishedWorks",
          summary: "List works published in the public gallery",
          description:
            "Returns the works currently visible to everyone on the site gallery (/gallery), newest first. Use it when the user asks what is published on their site.",
          responses: {
            "200": {
              description: "List of published generations.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: generationSchema },
                    },
                    required: ["items"],
                  },
                },
              },
            },
          },
        },
      },
      "/api/autopilot/run": {
        post: {
          operationId: "runAutopilot",
          summary: "Run one autopilot step: publish finished videos and start a new one",
          description:
            "Fully automatic publishing: first it publishes any finished autopilot videos to the public gallery, then (unless there is already one running) it starts generating a new vertical social-media-style video from a rotating topics list, which will be published automatically when finished. The app owner can also schedule this daily via Vercel Cron, so call this when the user asks to generate and publish new videos now. Optional body: { type: \"image\"|\"video\", prompt: \"...\", create: false }.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["image", "video"],
                      description: "What the autopilot should create next. Default video (vertical 9:16).",
                    },
                    prompt: {
                      type: "string",
                      description: "Optional custom prompt. Leave empty to use the next topic from the built-in rotating list.",
                    },
                    create: {
                      type: "boolean",
                      description: "Set false to only publish finished works without creating a new task. Default true.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Autopilot step done. publishedIds = ids published now; created = the new task (if any) — poll getGeneration for it.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      publishedIds: { type: "array", items: { type: "string" } },
                      created: {
                        type: ["object", "null"],
                        properties: {
                          id: { type: "string" },
                          type: { type: "string" },
                          prompt: { type: "string" },
                        },
                      },
                      note: { type: ["string", "null"] },
                      summary: { type: "string" },
                    },
                    required: ["ok", "publishedIds"],
                  },
                },
              },
            },
            "401": {
              description: "Server requires AUTOPILOT_TOKEN — send it via the x-autopilot-token header.",
              content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
            },
          },
        },
      },
      "/api/generations": {
        get: {
          operationId: "listGenerations",
          summary: "List recent generations",
          description:
            "Returns the most recent generation tasks (newest first, up to 60) with type, prompt, status and resultUrls. Use it when the user asks to see their previous works.",
          responses: {
            "200": {
              description: "List of generations.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: generationSchema },
                    },
                    required: ["items"],
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  return NextResponse.json(schema, {
    headers: { "Cache-Control": "no-store" },
  });
}
