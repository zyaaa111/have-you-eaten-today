import { NextRequest, NextResponse } from "next/server";
import { deleteFromTable } from "@/lib/sync-api";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { ids?: string[]; space_id?: string };
  const { ids, space_id } = body;
  if (!Array.isArray(ids) || !space_id) {
    return NextResponse.json({ error: "缺少 ids 或 space_id" }, { status: 400 });
  }
  deleteFromTable("menu_items", ids, space_id);
  return NextResponse.json({ success: true, deleted: ids.length });
}
