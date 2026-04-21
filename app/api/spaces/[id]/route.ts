import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { requireSpaceMembership } from "@/lib/server-auth";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = requireSpaceMembership(request, id);
  if ("response" in auth) return auth.response;
  const space = db.prepare("SELECT * FROM spaces WHERE id = ?").get(id) as
    | { id: string; invite_code: string; name: string; created_at: number }
    | undefined;
  if (!space) {
    return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  }
  return NextResponse.json({
    id: space.id,
    inviteCode: space.invite_code,
    name: space.name,
    createdAt: space.created_at,
  });
}
