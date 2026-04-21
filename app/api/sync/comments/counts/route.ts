import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { requireSpaceMembership } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  const ids = request.nextUrl.searchParams.get("ids");
  if (!ids) {
    return NextResponse.json({ error: "缺少 space_id 或 ids" }, { status: 400 });
  }
  const menuItemIds = ids.split(",").filter(Boolean);
  const MAX_IDS = 200;
  if (menuItemIds.length > MAX_IDS) {
    return NextResponse.json({ error: `ids 最多支持 ${MAX_IDS} 个` }, { status: 400 });
  }
  if (menuItemIds.length === 0) {
    return NextResponse.json({});
  }
  const placeholders = menuItemIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT menu_item_id, COUNT(*) as cnt FROM comments WHERE space_id = ? AND menu_item_id IN (${placeholders}) GROUP BY menu_item_id`
  ).all(auth.membership.space.id, ...menuItemIds) as { menu_item_id: string; cnt: number }[];
  const result: Record<string, number> = {};
  for (const id of menuItemIds) {
    result[id] = 0;
  }
  for (const row of rows) {
    result[row.menu_item_id] = row.cnt;
  }
  return NextResponse.json(result);
}
