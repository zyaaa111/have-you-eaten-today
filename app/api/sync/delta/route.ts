import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { SyncTable, mapRows } from "@/lib/sync-api";
import { requireSpaceMembership } from "@/lib/server-auth";
import { buildLikeId } from "@/lib/like-id";
import { redactUnboundProfileReferences } from "@/lib/server-profile-redaction";

type SyncChangeKey = "menuItems" | "tags" | "comboTemplates" | "likes" | "comments";
type DeleteKey = "menu_items" | "tags" | "combo_templates" | "likes" | "comments";

const tableToResponseKey: Record<SyncTable, SyncChangeKey> = {
  menu_items: "menuItems",
  tags: "tags",
  combo_templates: "comboTemplates",
  likes: "likes",
  comments: "comments",
};

function getCurrentCursor(spaceId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_logs WHERE space_id = ?")
    .get(spaceId) as { cursor: number } | undefined;
  return row?.cursor ?? 0;
}

function fetchRows(table: SyncTable, ids: string[], spaceId: string) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE space_id = ? AND id IN (${placeholders})`)
    .all(spaceId, ...ids) as Record<string, unknown>[];
  return mapRows(table, rows, spaceId);
}

function parseSnapshot(snapshot: string | null | undefined): Record<string, unknown> | null {
  if (!snapshot) return null;
  try {
    return JSON.parse(snapshot) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  const spaceId = auth.membership.space.id;
  const cursor = Math.max(0, Number(request.nextUrl.searchParams.get("cursor") || 0));
  const limit = Math.min(500, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 200)));

  const rows = db.prepare(
    `SELECT seq, table_name, record_id, operation, before_snapshot, after_snapshot
     FROM change_logs
     WHERE space_id = ? AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`
  ).all(spaceId, cursor, limit) as Array<{
    seq: number;
    table_name: DeleteKey;
    record_id: string;
    operation: "create" | "update" | "delete";
    before_snapshot: string | null;
    after_snapshot: string | null;
  }>;

  const serverCursor = getCurrentCursor(spaceId);
  const currentCursor = rows.length > 0 ? rows[rows.length - 1]!.seq : serverCursor;
  const latestByRecord = new Map<
    string,
    {
      tableName: DeleteKey;
      recordId: string;
      operation: "create" | "update" | "delete";
      beforeSnapshot: Record<string, unknown> | null;
      afterSnapshot: Record<string, unknown> | null;
    }
  >();

  for (const row of rows) {
    latestByRecord.set(`${row.table_name}:${row.record_id}`, {
      tableName: row.table_name,
      recordId: row.record_id,
      operation: row.operation,
      beforeSnapshot: parseSnapshot(row.before_snapshot),
      afterSnapshot: parseSnapshot(row.after_snapshot),
    });
  }

  const changedIds: Record<SyncTable, string[]> = {
    menu_items: [],
    tags: [],
    combo_templates: [],
    likes: [],
    comments: [],
  };
  const deleted: Record<DeleteKey, string[]> = {
    menu_items: [],
    tags: [],
    combo_templates: [],
    likes: [],
    comments: [],
  };

  for (const change of Array.from(latestByRecord.values())) {
    if (change.operation === "delete") {
      if (change.tableName === "likes") {
        const redactedChange = redactUnboundProfileReferences(spaceId, {
          tableName: "likes",
          recordId: change.recordId,
          beforeSnapshot: change.beforeSnapshot,
          afterSnapshot: change.afterSnapshot,
        }) as {
          recordId?: string;
          beforeSnapshot?: Record<string, unknown> | null;
          afterSnapshot?: Record<string, unknown> | null;
        };
        const snapshot = redactedChange.afterSnapshot ?? redactedChange.beforeSnapshot ?? null;
        if (
          snapshot &&
          typeof snapshot.spaceId === "string" &&
          typeof snapshot.menuItemId === "string" &&
          typeof snapshot.profileId === "string"
        ) {
          deleted.likes.push(buildLikeId(snapshot.spaceId, snapshot.menuItemId, snapshot.profileId));
          continue;
        }
      }
      deleted[change.tableName].push(change.recordId);
      continue;
    }
    changedIds[change.tableName as SyncTable].push(change.recordId);
  }

  return NextResponse.json({
    cursor: currentCursor,
    serverCursor,
    hasMore: currentCursor < serverCursor,
    changes: {
      menuItems: fetchRows("menu_items", changedIds.menu_items, spaceId),
      tags: fetchRows("tags", changedIds.tags, spaceId),
      comboTemplates: fetchRows("combo_templates", changedIds.combo_templates, spaceId),
      likes: fetchRows("likes", changedIds.likes, spaceId),
      comments: fetchRows("comments", changedIds.comments, spaceId),
    },
    deleted,
  });
}
