import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { v4 as uuidv4 } from "uuid";
import { getSessionUser } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const sessionUser = getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "请先登录账号，再加入共享空间" }, { status: 401 });
  }

  const body = (await request.json()) as { invite_code?: string; nickname?: string };
  const { invite_code, nickname } = body;
  if (!invite_code || !nickname) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  const code = String(invite_code).trim().toUpperCase();
  const space = db.prepare("SELECT * FROM spaces WHERE invite_code = ?").get(code) as
    | { id: string; invite_code: string; name: string; created_at: number }
    | undefined;

  if (!space) {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }

  const existing = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(sessionUser.id) as
    | { id: string; space_id: string; user_id: string | null; nickname: string; joined_at: number }
    | undefined;

  if (existing && existing.space_id !== space.id) {
    return NextResponse.json({ error: "当前身份已加入其他空间，请先退出当前空间" }, { status: 409 });
  }

  if (!existing) {
    const profileId = uuidv4();
    const joinedAt = Date.now();
    const insertProfile = db.prepare(
      "INSERT INTO profiles (id, space_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?, ?)"
    );
    insertProfile.run(profileId, space.id, sessionUser.id, nickname, joinedAt);
    return NextResponse.json({
      space: {
        id: space.id,
        inviteCode: space.invite_code,
        name: space.name,
        createdAt: space.created_at,
        updatedAt: space.created_at,
      },
      profile: {
        id: profileId,
        spaceId: space.id,
        userId: sessionUser.id,
        nickname,
        joinedAt,
      },
    });
  }

  return NextResponse.json({
    space: {
      id: space.id,
      inviteCode: space.invite_code,
      name: space.name,
      createdAt: space.created_at,
      updatedAt: space.created_at,
    },
    profile: {
      id: existing.id,
      spaceId: existing.space_id,
      userId: sessionUser.id,
      nickname: existing.nickname,
      joinedAt: existing.joined_at,
    },
  });
}
