import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { v4 as uuidv4 } from "uuid";
import { getSessionUser } from "@/lib/server-auth";

const MAX_INVITE_CODE_RETRIES = 8;

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function POST(request: NextRequest) {
  const sessionUser = getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "请先登录账号，再创建共享空间" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string; nickname?: string };
  const { name, nickname } = body;
  if (!name || !nickname) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  const existingProfile = db.prepare("SELECT id, space_id FROM profiles WHERE user_id = ?").get(sessionUser.id) as
    | { id: string; space_id: string }
    | undefined;
  if (existingProfile) {
    return NextResponse.json({ error: "当前身份已加入其他空间，请先退出当前空间" }, { status: 409 });
  }

  const spaceId = uuidv4();
  const profileId = uuidv4();
  const now = Date.now();

  const createSpaceWithProfile = db.transaction((candidateCode: string) => {
    const insertSpace = db.prepare("INSERT INTO spaces (id, invite_code, name, created_at) VALUES (?, ?, ?, ?)");
    const insertProfile = db.prepare(
      "INSERT INTO profiles (id, space_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?, ?)"
    );

    insertSpace.run(spaceId, candidateCode, name, now);
    insertProfile.run(profileId, spaceId, sessionUser.id, nickname, now);
  });

  let inviteCode = "";
  for (let attempt = 0; attempt < MAX_INVITE_CODE_RETRIES; attempt++) {
    inviteCode = generateInviteCode();
    try {
      createSpaceWithProfile(inviteCode);
      return NextResponse.json({
        space: {
          id: spaceId,
          inviteCode,
          name,
          createdAt: now,
          updatedAt: now,
        },
        profile: {
          id: profileId,
          spaceId,
          userId: sessionUser.id,
          nickname,
          joinedAt: now,
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: spaces.invite_code")) {
        throw error;
      }
    }
  }

  return NextResponse.json({ error: "邀请码生成失败，请稍后重试" }, { status: 503 });
}
