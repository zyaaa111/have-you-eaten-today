import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server-auth";
import { db } from "@/lib/db-server";
import { rollSharedRecommendations } from "@/lib/server-recommendations";

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: {
    space_id?: string;
    profile_ids?: string[];
    kind?: "recipe" | "takeout";
    tag_ids?: string[];
    menu_item_ids?: string[];
    recent_history_ids?: string[];
    template_id?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const spaceId = typeof body.space_id === "string" ? body.space_id : "";
  const profileIds = Array.isArray(body.profile_ids) ? body.profile_ids.filter((id): id is string => typeof id === "string") : [];
  if (!spaceId || profileIds.length === 0) {
    return NextResponse.json({ error: "缺少 space_id 或 profile_ids" }, { status: 400 });
  }

  const placeholders = profileIds.map(() => "?").join(",");
  const members = db.prepare(
    `SELECT id
     FROM profiles
     WHERE space_id = ? AND user_id IS NOT NULL AND id IN (${placeholders})`
  ).all(spaceId, ...profileIds) as Array<{ id: string }>;
  if (members.length !== profileIds.length) {
    return NextResponse.json({ error: "成员列表不属于当前空间，或仍未绑定账号" }, { status: 400 });
  }

  const currentMembership = db.prepare(
    "SELECT id FROM profiles WHERE space_id = ? AND user_id = ? LIMIT 1"
  ).get(spaceId, user.id) as { id: string } | undefined;
  if (!currentMembership || !profileIds.includes(currentMembership.id)) {
    return NextResponse.json({ error: "当前登录账号必须包含在参与成员中" }, { status: 403 });
  }

  const result = rollSharedRecommendations({
    spaceId,
    profileIds,
    kind: body.kind,
    tagIds: Array.isArray(body.tag_ids) ? body.tag_ids : undefined,
    menuItemIds: Array.isArray(body.menu_item_ids) ? body.menu_item_ids : undefined,
    recentHistoryIds: Array.isArray(body.recent_history_ids) ? body.recent_history_ids : undefined,
    templateId: typeof body.template_id === "string" ? body.template_id : undefined,
  });

  if (!result) {
    return NextResponse.json({ error: "没有符合条件的菜单项" }, { status: 404 });
  }

  return NextResponse.json(result);
}
