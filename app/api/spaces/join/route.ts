import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { invite_code?: string; nickname?: string; user_id?: string };
  const { invite_code, nickname, user_id } = body;
  if (!invite_code || !nickname || !user_id) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  const code = String(invite_code).trim().toUpperCase();
  const space = db.prepare("SELECT * FROM spaces WHERE invite_code = ?").get(code) as
    | { id: string; invite_code: string; name: string; created_at: number }
    | undefined;

  if (!space) {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }

  const existing = db.prepare("SELECT * FROM profiles WHERE id = ? AND space_id = ?").get(user_id, space.id) as
    | { id: string; space_id: string; nickname: string; joined_at: number }
    | undefined;

  if (!existing) {
    const insertProfile = db.prepare("INSERT INTO profiles (id, space_id, nickname, joined_at) VALUES (?, ?, ?, ?)");
    insertProfile.run(user_id, space.id, nickname, Date.now());
  }

  return NextResponse.json({
    id: space.id,
    inviteCode: space.invite_code,
    name: space.name,
    createdAt: space.created_at,
  });
}
