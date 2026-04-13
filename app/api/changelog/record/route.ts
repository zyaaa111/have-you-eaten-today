import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { toCamelCase } from "@/lib/sync-api";

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
  const tableName = request.nextUrl.searchParams.get("table_name");
  const recordId = request.nextUrl.searchParams.get("record_id");
  if (!spaceId || !tableName || !recordId) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  const rows = db
    .prepare("SELECT * FROM change_logs WHERE space_id = ? AND table_name = ? AND record_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(spaceId, tableName, recordId) as Record<string, unknown>[];

  return NextResponse.json(
    rows.map((r) => {
      const c = toCamelCase(r);
      c.beforeSnapshot = parseSnapshot(c.beforeSnapshot as string | undefined);
      c.afterSnapshot = parseSnapshot(c.afterSnapshot as string | undefined);
      return c;
    })
  );
}
