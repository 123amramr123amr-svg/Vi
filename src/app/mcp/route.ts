import { NextRequest, NextResponse } from "next/server";
import { handleRpcMessage } from "@/lib/mcp/protocol";
import { callTool, setResultOrigin } from "@/lib/mcp/tools";
import type { JsonRpcResponse } from "@/lib/mcp/types";
import { ensureSchema } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

/**
 * خادم MCP (Model Context Protocol) — نقطة نهاية Streamable HTTP بوضع عديم الحالة.
 *
 * POST — رسائل JSON-RPC 2.0:
 * - الطلبات (initialize / tools/list / tools/call / ping) → رد JSON-RPC واحد.
 * - الإشعارات (بدون id مثل notifications/initialized) → 202 بلا جسم.
 * - مصفوفة رسائل (batch) → مصفوفة الردود.
 * GET/DELETE → 405 (خادم عديم الحالة لا يوفر تدفقات SSE ولا جلسات).
 * OPTIONS → ترويسات CORS لأي عميل ويب.
 *
 * الحماية: إذا ضُبط متغير البيئة MCP_API_KEY يُطلب Authorization: Bearer <key>؛
 * وإلا يبقى الرابط مفتوحًا مثل بقية مسارات API.
 */

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.MCP_API_KEY?.trim();
  if (!expected) return true;
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  return bearer === expected;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "Unauthorized: send the Authorization: Bearer <MCP_API_KEY> header",
        },
      },
      { status: 401, headers: JSON_HEADERS }
    );
  }
  await ensureSchema();

  /* أصل الطلب — يجعل روابط /api/media مطلقة في ردود MCP للعملاء الخارجيين */
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
    setResultOrigin(`${proto}://${host}`);
  }

  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: body is not valid JSON" },
      },
      { status: 400, headers: JSON_HEADERS }
    );
  }

  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    for (const message of body) {
      const r = await handleRpcMessage(message, { callTool });
      if (r) responses.push(r);
    }
    if (responses.length === 0) return new NextResponse(null, { status: 202 });
    return NextResponse.json(responses, { headers: JSON_HEADERS });
  }

  const r = await handleRpcMessage(body, { callTool });
  if (!r) return new NextResponse(null, { status: 202 });
  return NextResponse.json(r, { headers: JSON_HEADERS });
}

function methodNotAllowed() {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message:
          "Method Not Allowed — this MCP server is stateless: POST JSON-RPC messages to this URL",
      },
    },
    { status: 405, headers: { ...JSON_HEADERS, Allow: "POST, OPTIONS" } }
  );
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    },
  });
}
