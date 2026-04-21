import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { toCamelCase } from "@/lib/sync-api";
import { sanitizeMenuItemSnapshot } from "@/lib/menu-item-sanitize";
import { requireSpaceMembership } from "@/lib/server-auth";
import { redactUnboundProfileReferences } from "@/lib/server-profile-redaction";

function parseSnapshot(snap: string | null | undefined) {
  if (!snap) return null;
  try {
    return JSON.parse(snap);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  const spaceId = auth.membership.space.id;
  const tableName = request.nextUrl.searchParams.get("table_name");
  const recordId = request.nextUrl.searchParams.get("record_id");
  if (!tableName || !recordId) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  const rows = db
    .prepare("SELECT * FROM change_logs WHERE space_id = ? AND table_name = ? AND record_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(spaceId, tableName, recordId) as Record<string, unknown>[];

  const payload = rows.map((r) => {
    const c = toCamelCase(r);
    c.beforeSnapshot = parseSnapshot(c.beforeSnapshot as string | undefined);
    c.afterSnapshot = parseSnapshot(c.afterSnapshot as string | undefined);
    if (c.tableName === "menu_items") {
      c.beforeSnapshot = sanitizeMenuItemSnapshot(c.beforeSnapshot as Record<string, unknown> | null);
      c.afterSnapshot = sanitizeMenuItemSnapshot(c.afterSnapshot as Record<string, unknown> | null);
    }
    return c;
  });

  return NextResponse.json(redactUnboundProfileReferences(spaceId, payload));
}
