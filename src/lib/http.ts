import type { NextRequest } from "next/server";

/**
 * أصل الطلب من الترويسات (يعمل على localhost وعلى Vercel خلف البروكسي) —
 * يُستخدم لتحويل الروابط الداخلية مثل /api/media/{id} إلى روابط مطلقة
 * صالحة للعملاء الخارجيين (المعرض، ChatGPT، عملاء MCP).
 */
export function requestOrigin(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** تحويل الروابط الداخلية (التي تبدأ بـ /) إلى مطلقة وفق أصل الطلب */
export function absolutizeUrls(urls: string[], origin: string): string[] {
  return urls.map((u) => (u.startsWith("/") ? `${origin}${u}` : u));
}
