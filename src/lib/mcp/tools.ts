import { z } from "zod";
import { runAutopilotStep } from "@/lib/autopilot-runner";
import { runMergeJob } from "@/lib/merge";
import { waitForGeneration } from "@/lib/poll";
import { createMergeJob } from "@/lib/merge-service";
import { startGeneration } from "@/lib/tasks";
import {
  deleteGeneration,
  getGeneration,
  getMerge,
  listGenerations,
  listPublished,
  updateGeneration,
} from "@/lib/turso";
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  type Generation,
  type MergeJob,
} from "@/lib/types";
import { ToolDefinitionError, type ToolCallResult } from "./types";

/**
 * أدوات خادم MCP — تغطي كل قدرات VI AI Studio:
 * توليد الصور والفيديو، متابعة الحالة، السجل، النشر في المعرض العام،
 * الحذف، والأوتوبايلوت (النشر التلقائي دون تدخل بشري).
 * الأسماء والأوصاف بالإنجليزية لأنها تُقرأ من وكيل الذكاء الاصطناعي.
 */

/** تحويل مخطط zod إلى JSON Schema (مع احتياط آمن) */
function schemaOf(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

const waitSecondsArgs = {
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(45)
    .default(0)
    .describe(
      "If greater than 0, keep polling and return the final result in the same call (up to 45 seconds). 0 = return the task id immediately."
    ),
};

const imageArgs = z.object({
  prompt: z
    .string()
    .min(1)
    .max(20000)
    .describe(
      "Detailed English visual description of the image to generate. Rich detail (subject, style, lighting, camera angle, mood) gives the best results."
    ),
  aspect_ratio: z
    .enum(IMAGE_ASPECT_RATIOS)
    .default("auto")
    .describe("Aspect ratio, e.g. 1:1 square, 16:9 wide, 9:16 vertical for social media."),
  resolution: z
    .enum(IMAGE_RESOLUTIONS)
    .default("1K")
    .describe("Output resolution: 1K, 2K or 4K."),
  ...waitSecondsArgs,
});

const videoArgs = z.object({
  prompt: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "Detailed English visual description of the video clip (subject, motion, camera movement, atmosphere)."
    ),
  aspect_ratio: z
    .enum(VIDEO_ASPECT_RATIOS)
    .default("auto")
    .describe("Aspect ratio, e.g. 16:9 wide, 9:16 vertical."),
  resolution: z
    .enum(VIDEO_RESOLUTIONS)
    .default("720p")
    .describe("Video resolution: 480p, 720p or 1080p."),
  duration: z
    .number()
    .int()
    .min(1)
    .max(15)
    .default(8)
    .describe("Clip length in seconds (1-15)."),
  enable_audio: z
    .boolean()
    .default(true)
    .describe("Whether to generate audio for the clip."),
  image_urls: z
    .array(z.string().url())
    .max(3)
    .optional()
    .describe(
      "Optional public https image URLs for image-to-video: the model animates them. Leave empty for pure text-to-video."
    ),
  ...waitSecondsArgs,
});

const continueArgs = z.object({
  parent_id: z
    .string()
    .min(1)
    .describe(
      "Generation id of the previous successful VIDEO part to continue (from get_generation or list_generations; must have status=success). The new part is chained to it and gets part_number = parent + 1."
    ),
  prompt: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "Description of what happens in the NEXT part: camera movement, actions, scene changes."
    ),
  mode: z
    .enum(["images", "extend"])
    .default("images")
    .describe(
      "images = animate the provided image_urls as the next part (recommended, default). extend = provider-native Video Extend that continues the exact same video from its end (no images needed)."
    ),
  image_urls: z
    .array(z.string().url())
    .max(3)
    .optional()
    .describe(
      "Public https image URLs to animate (mode=images). Use any public image URL, or URLs like <server>/api/uploads/<id> after uploading via the website."
    ),
  duration: z
    .number()
    .int()
    .min(1)
    .max(15)
    .default(15)
    .describe("Length of the NEW part in seconds (1-15)."),
  extend_at: z
    .number()
    .int()
    .min(0)
    .max(120)
    .optional()
    .describe(
      "mode=extend only: second in the source video where the extension starts (0 = from the end, provider default)."
    ),
  ...waitSecondsArgs,
});

const getArgs = z.object({
  id: z
    .string()
    .min(1)
    .describe("Generation id returned by generate_image / generate_video."),
  wait_seconds: z
    .number()
    .int()
    .min(0)
    .max(45)
    .default(0)
    .describe("Poll for up to this many seconds before responding (0 = instant snapshot)."),
});

const listArgs = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of items to return (most recent first)."),
});

const publishArgs = z.object({
  id: z.string().min(1).describe("Generation id to publish or unpublish."),
  publish: z
    .boolean()
    .default(true)
    .describe(
      "true = show the work in the public gallery on the website (/gallery). false = hide it from the gallery (it stays in the private history)."
    ),
});

const deleteArgs = z.object({
  id: z.string().min(1).describe("Generation id to delete from the history."),
});

const mergeArgs = z.object({
  ids: z
    .array(z.string().min(1))
    .min(2)
    .max(8)
    .describe(
      "Generation ids of 2-8 SUCCESSFUL video generations, in the exact order they should appear in the merged clip. Each must be a completed video (status=success)."
    ),
  ...waitSecondsArgs,
});

const autopilotArgs = z.object({
  create: z
    .boolean()
    .default(true)
    .describe(
      "false = only scan running autopilot tasks and publish the finished ones. true = also create a new vertical social-media video task when nothing is running."
    ),
  type: z
    .enum(["image", "video"])
    .optional()
    .describe("Kind of task to create when create=true (default: video)."),
  prompt: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Custom prompt for the new task. Omit to rotate through the built-in topic list (or the AUTOPILOT_TOPICS env variable)."
    ),
});

/** تعريفات الأدوات لـ tools/list (inputSchema بصيغة JSON Schema) */
export function getToolDefs(): Array<Record<string, unknown>> {
  return [
    {
      name: "generate_image",
      title: "Generate image",
      description:
        "Create an AI image generation task in VI AI Studio (backed by kie.ai). Returns the generation id and taskId. Use wait_seconds>0 to get the finished URLs in the same call, or poll get_generation afterwards.",
      inputSchema: schemaOf(imageArgs),
    },
    {
      name: "generate_video",
      title: "Generate video",
      description:
        "Create an AI video generation task (grok-imagine) in VI AI Studio. Optional image_urls animates the images (image-to-video). Images take ~20-60s; videos take a few minutes — use wait_seconds or poll get_generation until status is success/fail. To continue a finished video into a multi-part chain, use continue_video instead.",
      inputSchema: schemaOf(videoArgs),
    },
    {
      name: "continue_video",
      title: "Continue a video (next part)",
      description:
        "Create the NEXT part of a previously generated video (multi-part chains, 15s each). mode=images animates provided image_urls as the next part (aspect ratio and resolution are inherited from the parent); mode=extend uses the provider-native Video Extend to continue the exact same video from its end. Returns the new generation id; poll get_generation until success.",
      inputSchema: schemaOf(continueArgs),
    },
    {
      name: "get_generation",
      title: "Get generation status/result",
      description:
        "Fetch one generation by id (status, resultUrls, error) and refresh it from the provider. Use wait_seconds to poll until completion inside a single call.",
      inputSchema: schemaOf(getArgs),
    },
    {
      name: "list_generations",
      title: "List generation history",
      description:
        "List the most recent generations (the website's private history) with status and result URLs.",
      inputSchema: schemaOf(listArgs),
    },
    {
      name: "list_published",
      title: "List published gallery works",
      description:
        "List works currently published in the public gallery on the website (/gallery).",
      inputSchema: schemaOf(listArgs),
    },
    {
      name: "publish_generation",
      title: "Publish / unpublish to gallery",
      description:
        "Publish a successfully completed generation to the public gallery on the website, or hide it again with publish=false.",
      inputSchema: schemaOf(publishArgs),
    },
    {
      name: "delete_generation",
      title: "Delete a generation",
      description: "Delete one generation from the history (cannot be undone).",
      inputSchema: schemaOf(deleteArgs),
    },
    {
      name: "merge_videos",
      title: "Merge multiple videos into one",
      description:
        "Concatenate 2-8 successfully completed video generations (in the given order) into a single MP4 file via ffmpeg. Returns the merged file URL; poll get result with wait_seconds>0 or fetch the returned file URL once status=success.",
      inputSchema: schemaOf(mergeArgs),
    },
    {
      name: "run_autopilot",
      title: "Run autopilot step",
      description:
        "One idempotent autopilot step: publish finished auto-tasks to the gallery, and (create=true) start the next vertical social-media video from the rotating topic list when nothing is running. Use it to keep the website publishing new videos automatically without human intervention.",
      inputSchema: schemaOf(autopilotArgs),
    },
  ];
}

/* ---------- مساعدات النتائج ---------- */

function toolText(payload: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function parseArgs<T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>
): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue && issue.path.length > 0
        ? `${issue.path.map(String).join(".")}: `
        : "";
    throw new ToolDefinitionError(
      `Invalid arguments for tool — ${where}${issue?.message ?? "validation failed"}`
    );
  }
  return parsed.data;
}

/** أصل الطلب الحالي (مثل https://app.vercel.app) لتحويل الروابط الداخلية لمطلقة */
let resultOrigin: string | null = null;

/** يُستدعى من مسار MCP لكل طلب — يجعل روابط /api/media مطلقة للعملاء الخارجيين */
export function setResultOrigin(origin: string | null): void {
  resultOrigin = origin;
}

function absolutize(url: string): string {
  if (!resultOrigin || !url.startsWith("/")) return url;
  return `${resultOrigin}${url}`;
}

/** أصل الطلب الحالي إن ضُبط — يُستخدم لتحويل روابط /api/media و /api/merge لمطلقة */
export function getResultOrigin(): string | null {
  return resultOrigin;
}

function serializeGeneration(row: Generation): Record<string, unknown> {
  return {
    id: row.id,
    taskId: row.taskId,
    type: row.type,
    model: row.model,
    status: row.status,
    prompt:
      row.prompt.length > 300 ? `${row.prompt.slice(0, 300)}…` : row.prompt,
    params: row.params,
    resultUrls: row.resultUrls.map(absolutize),
    error: row.error,
    published: row.published,
    parentId: row.parentId,
    partNumber: row.partNumber,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function withMessage(row: Generation, message: string): Record<string, unknown> {
  return { ...serializeGeneration(row), message };
}

/** رد أداة merge_videos وفق حالة وظيفة الدمج */
function mergeResult(job: MergeJob): ToolCallResult {
  return toolText({
    id: job.id,
    status: job.status,
    error: job.error,
    generationIds: job.generationIds,
    fileUrl: absolutize(job.fileUrl),
    message:
      job.status === "success"
        ? "Videos merged successfully — the single merged MP4 is downloadable at fileUrl."
        : job.status === "fail"
          ? `Merge failed: ${job.error ?? "unknown error"}`
          : "Merging is in progress (ffmpeg). Call merge_videos again in ~20-40 seconds or GET /api/merge/{id} until status=success.",
  });
}

function generationMessage(row: Generation): Record<string, unknown> {
  if (row.status === "success") {
    return withMessage(
      row,
      "Generation completed successfully — the final URL(s) are in resultUrls."
    );
  }
  if (row.status === "fail") {
    return withMessage(row, `Generation failed: ${row.error ?? "unknown error"}`);
  }
  return withMessage(
    row,
    `Task is still in progress (status: ${row.status}). Poll get_generation with wait_seconds=30-45 until status becomes success or fail (images usually take 20-60s, videos a few minutes).`
  );
}

async function finishGeneration(
  row: Generation,
  waitSeconds: number
): Promise<ToolCallResult> {
  const final = waitSeconds > 0 ? await waitForGeneration({ row, waitSeconds }) : row;
  return toolText(generationMessage(final));
}

/* ---------- تنفيذ الأدوات ---------- */

/** تنفيذ أداة باسمها ومدخلاتها — قد ترمي ToolDefinitionError للمدخلات الخاطئة */
export async function callTool(
  name: string,
  rawArgs: Record<string, unknown>
): Promise<ToolCallResult> {
  switch (name) {
    case "generate_image": {
      const args = parseArgs(imageArgs, rawArgs);
      const prompt = args.prompt.trim();
      if (!prompt) {
        throw new ToolDefinitionError("Invalid arguments for tool — prompt is required");
      }
      const row = await startGeneration({
        type: "image",
        prompt,
        aspectRatio: args.aspect_ratio,
        resolution: args.resolution,
      });
      return finishGeneration(row, args.wait_seconds);
    }

    case "generate_video": {
      const args = parseArgs(videoArgs, rawArgs);
      const prompt = args.prompt.trim();
      if (!prompt) {
        throw new ToolDefinitionError("Invalid arguments for tool — prompt is required");
      }
      const row = await startGeneration({
        type: "video",
        prompt,
        aspectRatio: args.aspect_ratio,
        resolution: args.resolution,
        duration: args.duration,
        enableAudio: args.enable_audio,
        imageUrls: args.image_urls,
      });
      return finishGeneration(row, args.wait_seconds);
    }

    case "continue_video": {
      const args = parseArgs(continueArgs, rawArgs);
      const prompt = args.prompt.trim();
      if (!prompt) {
        throw new ToolDefinitionError("Invalid arguments for tool — prompt is required");
      }
      if (args.mode === "images" && (!args.image_urls || args.image_urls.length === 0)) {
        throw new ToolDefinitionError(
          "Invalid arguments for tool — mode=images requires image_urls (or use mode=extend)."
        );
      }
      const row = await startGeneration({
        type: "video",
        prompt,
        duration: args.duration,
        parentId: args.parent_id,
        extend: args.mode === "extend",
        extendAt: args.extend_at,
        imageUrls: args.mode === "images" ? args.image_urls : undefined,
      });
      return finishGeneration(row, args.wait_seconds);
    }

    case "get_generation": {
      const args = parseArgs(getArgs, rawArgs);
      let row = await getGeneration(args.id);
      if (!row) return toolError(`Generation not found: ${args.id}`);
      row = await waitForGeneration({ row, waitSeconds: args.wait_seconds });
      return toolText(generationMessage(row));
    }

    case "list_generations": {
      const args = parseArgs(listArgs, rawArgs);
      const items = await listGenerations(args.limit);
      return toolText({
        count: items.length,
        items: items.map(serializeGeneration),
      });
    }

    case "list_published": {
      const args = parseArgs(listArgs, rawArgs);
      const items = await listPublished(args.limit);
      return toolText({
        count: items.length,
        items: items.map(serializeGeneration),
      });
    }

    case "publish_generation": {
      const args = parseArgs(publishArgs, rawArgs);
      const row = await getGeneration(args.id);
      if (!row) return toolError(`Generation not found: ${args.id}`);

      if (args.publish) {
        if (row.status !== "success" || row.resultUrls.length === 0) {
          return toolError(
            "Only successfully completed generations can be published. Poll get_generation first and wait for status=success."
          );
        }
        if (!row.published) {
          await updateGeneration(row.id, {
            published: true,
            publishedAt: Date.now(),
          });
        }
      } else if (row.published) {
        await updateGeneration(row.id, { published: false, publishedAt: null });
      }

      const updated = await getGeneration(row.id);
      return toolText(
        updated
          ? withMessage(
              updated,
              args.publish
                ? "Published to the public gallery (/gallery)."
                : "Hidden from the public gallery (kept in the private history)."
            )
          : { ok: true }
      );
    }

    case "delete_generation": {
      const args = parseArgs(deleteArgs, rawArgs);
      const row = await getGeneration(args.id);
      if (!row) return toolError(`Generation not found: ${args.id}`);
      await deleteGeneration(args.id);
      return toolText({
        ok: true,
        deleted: args.id,
        message: "Generation deleted from the history.",
      });
    }

    case "merge_videos": {
      const args = parseArgs(mergeArgs, rawArgs);
      const ids = [...new Set(args.ids)];
      if (ids.length < 2) {
        throw new ToolDefinitionError(
          "Invalid arguments for tool — at least 2 different video ids are required."
        );
      }
      for (const gid of ids) {
        const row = await getGeneration(gid);
        if (!row) {
          throw new ToolDefinitionError(`Video generation not found: ${gid}`);
        }
        if (row.type !== "video" || row.status !== "success" || row.resultUrls.length === 0) {
          throw new ToolDefinitionError(
            `Generation ${gid} is not a completed video — merge requires successful video generations (poll get_generation first).`
          );
        }
      }
      const job = await createMergeJob(ids, getResultOrigin() ?? "");
      if (args.wait_seconds > 0) {
        /* بناء فوري داخل الطلب — after() يبدأ فقط بعد إرسال الرد فلا يفيد الانتظار */
        await runMergeJob(job, getResultOrigin() ?? "");
        const built = await getMerge(job.id);
        if (built && built.status !== "processing") return mergeResult(built);
      }
      const current = await getMerge(job.id);
      return mergeResult(current ?? job);
    }

    case "run_autopilot": {
      const args = parseArgs(autopilotArgs, rawArgs);
      const result = await runAutopilotStep({
        create: args.create,
        type: args.type,
        prompt: args.prompt?.trim() || undefined,
      });
      return toolText(result);
    }

    default:
      throw new ToolDefinitionError(`Unknown tool: ${name}`);
  }
}
