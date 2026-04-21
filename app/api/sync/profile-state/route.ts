import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server-auth";
import { doesUserOwnProfile } from "@/lib/server-auth";
import { getProfileState, replaceProfileState } from "@/lib/server-profile-state";
import type { ProfileStateExport } from "@/lib/types";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const profileId = request.nextUrl.searchParams.get("profile_id");
  const spaceId = request.nextUrl.searchParams.get("space_id");
  if (!profileId || !spaceId) {
    return NextResponse.json({ error: "缺少 profile_id 或 space_id" }, { status: 400 });
  }

  if (!doesUserOwnProfile(user.id, profileId, spaceId)) {
    return NextResponse.json({ error: "无权访问该成员的私有偏好" }, { status: 403 });
  }

  return NextResponse.json(getProfileState(profileId, spaceId));
}

export async function PUT(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: {
    profile_id?: string;
    space_id?: string;
    state?: ProfileStateExport;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }
  const profileId = typeof body.profile_id === "string" ? body.profile_id : "";
  const spaceId = typeof body.space_id === "string" ? body.space_id : "";
  if (!profileId || !spaceId || !body.state) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  if (!doesUserOwnProfile(user.id, profileId, spaceId)) {
    return NextResponse.json({ error: "无权修改该成员的私有偏好" }, { status: 403 });
  }

  replaceProfileState(profileId, spaceId, body.state);
  return NextResponse.json({ success: true });
}
