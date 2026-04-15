import { db } from "./db";
import type { Comment } from "./types";
import { getCurrentProfileId, getCurrentSpaceId, enrich } from "./space-ops";
import { generateAnonymousNickname } from "./anonymous-nickname";
import { getLocalIdentity } from "./supabase";

export async function getCommentsByMenuItem(menuItemId: string): Promise<Comment[]> {
  return db.comments
    .where("menuItemId")
    .equals(menuItemId)
    .sortBy("createdAt");
}

export async function getCommentsCountByMenuItems(menuItemIds: string[]): Promise<Record<string, number>> {
  if (menuItemIds.length === 0) return {};
  const result: Record<string, number> = {};
  for (const id of menuItemIds) {
    result[id] = 0;
  }
  const comments = await db.comments
    .where("menuItemId")
    .anyOf(menuItemIds)
    .toArray();
  for (const comment of comments) {
    result[comment.menuItemId] = (result[comment.menuItemId] ?? 0) + 1;
  }
  return result;
}

export async function addComment(menuItemId: string, content: string, isAnonymous: boolean): Promise<Comment> {
  const MAX_CONTENT_LENGTH = 2000;
  if (!content.trim()) {
    throw new Error("评论内容不能为空");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`评论内容不能超过 ${MAX_CONTENT_LENGTH} 个字符`);
  }

  const profileId = getCurrentProfileId();
  const spaceId = getCurrentSpaceId();
  if (!profileId || !spaceId) {
    throw new Error("请先加入或创建空间");
  }

  const identity = getLocalIdentity();
  const nickname = isAnonymous
    ? generateAnonymousNickname(profileId, menuItemId)
    : (identity?.profile.nickname ?? "用户");

  const comment = enrich<Comment>(
    {
      id: crypto.randomUUID(),
      menuItemId,
      nickname,
      content,
      isAnonymous,
      createdAt: Date.now(),
      updatedAt: undefined,
    },
    { syncStatus: "pending" }
  );
  await db.comments.add(comment);
  return comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  const profileId = getCurrentProfileId();
  const spaceId = getCurrentSpaceId();
  if (!profileId) {
    throw new Error("请先加入或创建空间");
  }

  const comment = await db.comments.get(commentId);
  if (!comment) return;
  if (comment.profileId !== profileId) {
    throw new Error("只能删除自己的评论");
  }

  await db.comments.delete(commentId);
  if (spaceId) {
    await db.pendingDeletions.add({
      tableName: "comments",
      recordId: commentId,
      spaceId,
      createdAt: Date.now(),
    });
  }
}
