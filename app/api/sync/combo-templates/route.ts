import { NextRequest, NextResponse } from "next/server";
import { pullTable, pushTable } from "@/lib/sync-api";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "缺少 space_id" }, { status: 400 });
  }
  return NextResponse.json(pullTable("combo_templates", spaceId));
}

export async function POST(request: NextRequest) {
  const items = (await request.json()) as Record<string, unknown>[];
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "请求体必须是数组" }, { status: 400 });
  }
  pushTable("combo_templates", items);
  return NextResponse.json({ success: true, count: items.length });
}
