import { NextRequest, NextResponse } from "next/server";
import { pullTable, pushTable } from "@/lib/sync-api";
import { requireSpaceMembership } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  return NextResponse.json(pullTable("menu_items", auth.membership.space.id));
}

export async function POST(request: NextRequest) {
  let items: unknown;
  try {
    items = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "请求体必须是数组" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }
  const requestedSpaceId =
    typeof items[0]?.space_id === "string"
      ? (items[0]?.space_id as string)
      : typeof items[0]?.spaceId === "string"
        ? (items[0]?.spaceId as string)
        : null;
  const auth = requireSpaceMembership(request, requestedSpaceId);
  if ("response" in auth) return auth.response;

  const normalizedItems = (items as Record<string, unknown>[]).map((item) => ({
    ...item,
    space_id: auth.membership.space.id,
    profile_id: auth.membership.profile.id,
  }));
  normalizedItems.forEach((item, idx) => {
    const row = item as Record<string, unknown>;
    console.log(`[Sync Receive] menu_item[${idx}] id=${row.id} hasImage=${!!row.image_url}`);
  });
  pushTable("menu_items", normalizedItems);
  return NextResponse.json({ success: true, count: normalizedItems.length });
}
