import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "缺少 space_id" }, { status: 400 });
  }
  const rows = db.prepare(
    "SELECT id, space_id, nickname, joined_at FROM profiles WHERE space_id = ?"
  ).all(spaceId);
  return NextResponse.json(rows);
}
