import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { toCamelCase } from "@/lib/sync-api";
import { sanitizeMenuItemSnapshot } from "@/lib/menu-item-sanitize";

function parseSnapshot(snap: string | null | undefined) {
  if (!snap) return null;
  try {
    return JSON.parse(snap);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("space_id");
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
  if (!spaceId) {
    return NextResponse.json({ error: "缺少 space_id" }, { status: 400 });
  }
  const rows = db
    .prepare("SELECT * FROM change_logs WHERE space_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(spaceId, limit) as Record<string, unknown>[];

  return NextResponse.json(
    rows.map((r) => {
      const c = toCamelCase(r);
      c.beforeSnapshot = parseSnapshot(c.beforeSnapshot as string | undefined);
      c.afterSnapshot = parseSnapshot(c.afterSnapshot as string | undefined);
      if (c.tableName === "menu_items") {
        c.beforeSnapshot = sanitizeMenuItemSnapshot(c.beforeSnapshot as Record<string, unknown> | null);
        c.afterSnapshot = sanitizeMenuItemSnapshot(c.afterSnapshot as Record<string, unknown> | null);
      }
      return c;
    })
  );
}
