/** أنواع مشتركة لخادم MCP (Model Context Protocol) */

/** نتيجة استدعاء أداة — محتوى نصي يحمل JSON قابلًا للتحليل من الوكيل */
export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * خطأ في تعريف الأداة (أداة غير معروفة أو مدخلات غير صالحة)
 * يُترجم إلى خطأ JSON-RPC -32602 Invalid params.
 */
export class ToolDefinitionError extends Error {}

/** سياق التنفيذ الذي يوفره خادم MCP */
export interface McpContext {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;
