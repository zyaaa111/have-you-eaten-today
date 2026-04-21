import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { createSessionResponse, getSessionUser } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { profileId?: string; spaceId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
  if (!profileId || !spaceId) {
    return NextResponse.json({ error: "缺少 profileId 或 spaceId" }, { status: 400 });
  }

  const existingMembership = db.prepare("SELECT id, space_id FROM profiles WHERE user_id = ? LIMIT 1").get(user.id) as
    | { id: string; space_id: string }
    | undefined;
  if (existingMembership && existingMembership.id !== profileId) {
    return NextResponse.json({ error: "当前账号已经绑定了其他空间身份" }, { status: 409 });
  }

  const profile = db.prepare(
    "SELECT id, space_id, user_id, nickname, joined_at FROM profiles WHERE id = ? AND space_id = ? LIMIT 1"
  ).get(profileId, spaceId) as
    | { id: string; space_id: string; user_id: string | null; nickname: string; joined_at: number }
    | undefined;

  if (!profile) {
    return NextResponse.json({ error: "当前设备保存的旧身份不存在" }, { status: 404 });
  }

  if (profile.user_id && profile.user_id !== user.id) {
    return NextResponse.json({ error: "这个旧身份已经绑定到其他账号" }, { status: 409 });
  }

  if (!profile.user_id) {
    db.prepare("UPDATE profiles SET user_id = ? WHERE id = ? AND space_id = ?").run(user.id, profileId, spaceId);
  }

  return createSessionResponse(user.id);
}
