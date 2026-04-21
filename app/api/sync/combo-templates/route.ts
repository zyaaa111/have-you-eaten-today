import { NextRequest, NextResponse } from "next/server";
import { pullTable, pushTable } from "@/lib/sync-api";
import { requireSpaceMembership } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  return NextResponse.json(pullTable("combo_templates", auth.membership.space.id));
}

export async function POST(request: NextRequest) {
  const items = (await request.json()) as Record<string, unknown>[];
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

  const normalizedItems = items.map((item) => ({
    ...item,
    space_id: auth.membership.space.id,
    profile_id: auth.membership.profile.id,
  }));
  pushTable("combo_templates", normalizedItems);
  return NextResponse.json({ success: true, count: normalizedItems.length });
}
