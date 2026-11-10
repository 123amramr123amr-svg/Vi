import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api — فحص صحة الخدمة */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "vi-ai-studio",
    time: new Date().toISOString(),
  });
}
