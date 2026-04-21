import { NextRequest, NextResponse } from "next/server";
import { deleteFromTable } from "@/lib/sync-api";
import { requireSpaceMembership } from "@/lib/server-auth";
import { db } from "@/lib/db-server";

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
  const auth = requireSpaceMembership(request, space_id);
  if ("response" in auth) return auth.response;
  const allowedIds = ids.filter((id) => {
    const row = db.prepare("SELECT id FROM likes WHERE id = ? AND profile_id = ? AND space_id = ? LIMIT 1").get(
      id,
      auth.membership.profile.id,
      auth.membership.space.id
    ) as { id: string } | undefined;
    return !!row;
  });
  const { deletedIds, missingIds } = deleteFromTable("likes", allowedIds, auth.membership.space.id);
  const rejectedIds = ids.filter((id) => !allowedIds.includes(id));
  return NextResponse.json({
    success: true,
    deleted: deletedIds.length,
    deletedIds,
    missingIds: [...missingIds, ...rejectedIds],
  });
}
