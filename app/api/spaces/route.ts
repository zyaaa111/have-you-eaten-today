import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { v4 as uuidv4 } from "uuid";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { name?: string; nickname?: string; user_id?: string };
  const { name, nickname, user_id } = body;
  if (!name || !nickname || !user_id) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  const spaceId = uuidv4();
  const inviteCode = generateInviteCode();
  const now = Date.now();

  const insertSpace = db.prepare("INSERT INTO spaces (id, invite_code, name, created_at) VALUES (?, ?, ?, ?)");
  const insertProfile = db.prepare("INSERT INTO profiles (id, space_id, nickname, joined_at) VALUES (?, ?, ?, ?)");

  insertSpace.run(spaceId, inviteCode, name, now);
  insertProfile.run(user_id, spaceId, nickname, now);

  return NextResponse.json({
    id: spaceId,
    inviteCode,
    name,
    createdAt: now,
  });
}
