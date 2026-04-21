import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { requireSpaceMembership } from "@/lib/server-auth";
import { buildLegacyProfilePlaceholder } from "@/lib/server-profile-redaction";

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  const spaceId = auth.membership.space.id;
  const rows = db.prepare(
    "SELECT id, space_id, user_id, nickname, joined_at FROM profiles WHERE space_id = ? ORDER BY joined_at ASC"
  ).all(spaceId) as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((row) => ({
      id:
        typeof row.user_id === "string" && row.user_id
          ? row.id
          : buildLegacyProfilePlaceholder(spaceId, String(row.id)),
      spaceId: row.space_id,
      userId: typeof row.user_id === "string" ? row.user_id : undefined,
      nickname: row.nickname,
      joinedAt: row.joined_at,
      isAccountBound: typeof row.user_id === "string" && row.user_id.length > 0,
    }))
  );
}
