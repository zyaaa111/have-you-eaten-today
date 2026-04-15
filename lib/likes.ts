import { db } from "./db";
import type { Like } from "./types";
import { getCurrentProfileId, getCurrentSpaceId } from "./space-ops";
import { enrich } from "./space-ops";
import { buildLikeId } from "./like-id";

export async function toggleLike(menuItemId: string): Promise<boolean> {
  const profileId = getCurrentProfileId();
  const spaceId = getCurrentSpaceId();
  if (!profileId || !spaceId) {
    throw new Error("请先加入或创建空间");
  }

  const existing = await db.likes
    .where("[menuItemId+profileId]")
    .equals([menuItemId, profileId])
    .first();

  if (existing) {
    await db.likes.delete(existing.id);
    await db.pendingDeletions.add({
      tableName: "likes",
      recordId: existing.id,
      spaceId,
      createdAt: Date.now(),
    });
    return false;
  }

  const like = enrich<Like>(
    {
      id: buildLikeId(spaceId, menuItemId, profileId),
      menuItemId,
      createdAt: Date.now(),
    },
    { syncStatus: "pending" }
  );
  await db.likes.add(like);
  return true;
}

export async function isLikedByCurrentUser(menuItemId: string): Promise<boolean> {
  const profileId = getCurrentProfileId();
  if (!profileId) return false;
  const existing = await db.likes
    .where("[menuItemId+profileId]")
    .equals([menuItemId, profileId])
    .first();
  return !!existing;
}

export async function getLikesCountByMenuItems(menuItemIds: string[]): Promise<Record<string, number>> {
  if (menuItemIds.length === 0) return {};
  const result: Record<string, number> = {};
  for (const id of menuItemIds) {
    result[id] = 0;
  }
  const likes = await db.likes
    .where("menuItemId")
    .anyOf(menuItemIds)
    .toArray();
  for (const like of likes) {
    result[like.menuItemId] = (result[like.menuItemId] ?? 0) + 1;
  }
  return result;
}
