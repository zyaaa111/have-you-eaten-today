import { NextRequest, NextResponse } from "next/server";
import { pullTable, pushTable } from "@/lib/sync-api";

const MAX_BATCH = 100;
const MAX_CONTENT_LENGTH = 2000;

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "缺少 space_id" }, { status: 400 });
  }
  return NextResponse.json(pullTable("comments", spaceId));
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "请求体必须是数组" }, { status: 400 });
  }
  if (body.length > MAX_BATCH) {
    return NextResponse.json({ error: `批量上限 ${MAX_BATCH}` }, { status: 400 });
  }
  const items = body as Record<string, unknown>[];
  for (const item of items) {
    if (typeof item.content === "string" && item.content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: `评论内容不能超过 ${MAX_CONTENT_LENGTH} 个字符` }, { status: 400 });
    }
  }
  pushTable("comments", items);
  return NextResponse.json({ success: true, count: items.length });
}
