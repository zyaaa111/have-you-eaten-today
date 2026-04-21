import { NextRequest, NextResponse } from "next/server";
import { pullTable, pushTable } from "@/lib/sync-api";
import { requireSpaceMembership } from "@/lib/server-auth";

const MAX_BATCH = 100;

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  return NextResponse.json(pullTable("likes", auth.membership.space.id));
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
  if (body.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }
  const items = body as Record<string, unknown>[];
  const requestedSpaceId =
    typeof items[0]?.space_id === "string"
      ? (items[0]?.space_id as string)
      : typeof items[0]?.spaceId === "string"
        ? (items[0]?.spaceId as string)
        : null;
  const auth = requireSpaceMembership(request, requestedSpaceId);
  if ("response" in auth) return auth.response;
  const normalizedItems = items.map((item) => ({
    ...item,
    space_id: auth.membership.space.id,
    profile_id: auth.membership.profile.id,
  }));
  pushTable("likes", normalizedItems);
  return NextResponse.json({ success: true, count: normalizedItems.length });
}
