import { NextRequest, NextResponse } from "next/server";
import { deleteFromTable } from "@/lib/sync-api";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }
  const { ids, space_id } = body as { ids?: string[]; space_id?: string };
  if (!Array.isArray(ids) || !space_id) {
    return NextResponse.json({ error: "缺少 ids 或 space_id" }, { status: 400 });
  }
  const { deletedIds, missingIds } = deleteFromTable("likes", ids, space_id);
  return NextResponse.json({ success: true, deleted: deletedIds.length, deletedIds, missingIds });
}
