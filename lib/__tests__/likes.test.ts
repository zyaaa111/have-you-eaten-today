import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, db } from "../db";
import { saveLocalIdentity } from "../supabase";
import type { Space, Profile } from "../types";
import { toggleLike, isLikedByCurrentUser, getLikesCountByMenuItems } from "../likes";
import { buildLikeId } from "../like-id";

const testSpace: Space = {
  id: "space_like_test",
  inviteCode: "LIKE01",
  name: "点赞测试空间",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const testProfile: Profile = {
  id: "profile_like_test",
  spaceId: testSpace.id,
  nickname: "测试用户",
  joinedAt: Date.now(),
};

describe("likes", () => {
  beforeEach(async () => {
    await resetDatabase();
    saveLocalIdentity({ space: testSpace, profile: testProfile });
  });

  it("should toggle like on and return true", async () => {
    const liked = await toggleLike("item1");
    expect(liked).toBe(true);
    const isLiked = await isLikedByCurrentUser("item1");
    expect(isLiked).toBe(true);
    const like = await db.likes.where("menuItemId").equals("item1").first();
    expect(like?.id).toBe(buildLikeId(testSpace.id, "item1", testProfile.id));
  });

  it("should toggle like off and return false", async () => {
    await toggleLike("item1");
    const liked = await toggleLike("item1");
    expect(liked).toBe(false);
    const isLiked = await isLikedByCurrentUser("item1");
    expect(isLiked).toBe(false);
  });

  it("should count likes per menu item", async () => {
    await toggleLike("item1");
    await toggleLike("item2");
    const counts = await getLikesCountByMenuItems(["item1", "item2", "item3"]);
    expect(counts["item1"]).toBe(1);
    expect(counts["item2"]).toBe(1);
    expect(counts["item3"]).toBe(0);
  });

  it("should return empty object for empty input", async () => {
    const counts = await getLikesCountByMenuItems([]);
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it("should not be liked when no space identity", async () => {
    localStorage.removeItem("space_identity");
    const isLiked = await isLikedByCurrentUser("item1");
    expect(isLiked).toBe(false);
  });

  it("should create pending deletion when unliking", async () => {
    await toggleLike("item1");
    await toggleLike("item1");
    const deletions = await db.pendingDeletions
      .where({ tableName: "likes" })
      .count();
    expect(deletions).toBe(1);
  });
});
