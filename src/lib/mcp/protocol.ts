import { getToolDefs } from "./tools";
import { ToolDefinitionError, type JsonRpcResponse, type McpContext } from "./types";

/**
 * طبقة بروتوكول MCP — JSON-RPC 2.0 عبر Streamable HTTP (وضع عديم الحالة).
 * تغطي الطرق الأساسية: initialize / notifications/initialized / ping /
 * tools/list / tools/call — مع دعم الإشعارات والردود الدفعية (batch).
 */

/** أحدث إصدار بروتوكول ندعمه */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** الإصدارات المقبولة من العميل (نرد إصدار العميل إن دعمناه) */
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

export const MCP_SERVER_INFO = {
  name: "vi-ai-studio",
  title: "VI AI Studio",
  version: "2.0.0",
} as const;

/** تعليمات تُعرض لوكيل الذكاء الاصطناعي عند الاتصال */
const SERVER_INSTRUCTIONS = `VI AI Studio MCP server — generate and publish AI images & videos (backed by kie.ai) on the owner's website.

Typical flows:
- Image: call generate_image with a detailed English prompt (wait_seconds=45 usually returns the finished URLs directly). Otherwise poll get_generation with wait_seconds=30-45 until status is "success" or "fail".
- Video: call generate_video the same way; videos take a few minutes, so keep polling get_generation.
- Publishing: publish_generation shows a finished work in the public gallery on the website (/gallery); list_published shows what is live now.
- Autopilot: run_autopilot publishes finished auto-tasks and starts the next vertical social-media video automatically — use it to keep the website publishing new videos with no human intervention.
- Housekeeping: list_generations shows the history; delete_generation removes an item.

Always return the real resultUrls from the tool output to the user; never invent URLs. Refuse harmful or inappropriate content requests.`;

function success(
  id: string | number | null,
  result: Record<string, unknown>
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * معالجة رسالة JSON-RPC واحدة.
 * يعيد رد JSON-RPC، أو null إذا كانت الرسالة إشعارًا/ردًا لا يحتاج جوابًا
 * (يُجيب الخادم بـ 202 Accepted بلا جسم).
 */
export async function handleRpcMessage(
  raw: unknown,
  ctx: McpContext
): Promise<JsonRpcResponse | null> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return failure(null, -32600, "Invalid Request: expected a JSON-RPC 2.0 message object");
  }

  const msg = raw as Record<string, unknown>;
  const id =
    "id" in msg && (typeof msg.id === "string" || typeof msg.id === "number")
      ? msg.id
      : null;

  if (typeof msg.method !== "string") {
    // ردّ من العميل على طلب من الخادم (لا نرسل طلبات في هذا الخادم) — لا جواب
    if ("result" in msg || "error" in msg) return null;
    const message = 'Invalid Request: "method" must be a string';
    return id !== null ? failure(id, -32600, message) : failure(null, -32600, message);
  }

  switch (msg.method) {
    case "initialize": {
      const params =
        typeof msg.params === "object" && msg.params !== null
          ? (msg.params as Record<string, unknown>)
          : {};
      const requested =
        typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      return success(id, {
        protocolVersion:
          requested && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
            ? requested
            : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case "ping":
      return success(id, {});

    case "tools/list":
      return success(id, { tools: getToolDefs() });

    case "tools/call": {
      const params =
        typeof msg.params === "object" && msg.params !== null
          ? (msg.params as Record<string, unknown>)
          : {};
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) {
        return id !== null
          ? failure(id, -32602, "Invalid params: tools/call requires params.name")
          : null;
      }
      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};

      try {
        const out = await ctx.callTool(name, args);
        return id !== null ? success(id, out as unknown as Record<string, unknown>) : null;
      } catch (err) {
        if (err instanceof ToolDefinitionError) {
          return id !== null ? failure(id, -32602, err.message) : null;
        }
        const text = err instanceof Error ? err.message : String(err);
        console.error("[vi] mcp tool execution failed:", err);
        return id !== null
          ? success(id, {
              content: [{ type: "text", text: JSON.stringify({ error: text }) }],
              isError: true,
            })
          : null;
      }
    }

    default:
      // أي إشعار (notifications/initialized، notifications/cancelled…) لا يحتاج جوابًا
      if (msg.method.startsWith("notifications/")) return null;
      return id !== null
        ? failure(id, -32601, `Method not found: ${msg.method}`)
        : null;
  }
}
