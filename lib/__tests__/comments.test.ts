import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../db";
import { saveLocalIdentity } from "../supabase";
import type { Space, Profile } from "../types";
import { addComment, deleteComment, getCommentsByMenuItem, getCommentsCountByMenuItems } from "../comments";

const testSpace: Space = {
  id: "space_comment_test",
  inviteCode: "CMT01",
  name: "评论测试空间",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const testProfile: Profile = {
  id: "profile_comment_test",
  spaceId: testSpace.id,
  nickname: "测试用户",
  joinedAt: Date.now(),
};

describe("comments", () => {
  beforeEach(async () => {
    await resetDatabase();
    saveLocalIdentity({ space: testSpace, profile: testProfile });
  });

  it("should add a comment and return it", async () => {
    const comment = await addComment("item1", "好吃！", false);
    expect(comment.menuItemId).toBe("item1");
    expect(comment.content).toBe("好吃！");
    expect(comment.isAnonymous).toBe(false);
    expect(comment.syncStatus).toBe("pending");
  });

  it("should add an anonymous comment with generated nickname", async () => {
    const comment = await addComment("item1", "匿名好评", true);
    expect(comment.isAnonymous).toBe(true);
    expect(comment.nickname).toBeTruthy();
    expect(comment.nickname).not.toBe("用户");
  });

  it("should retrieve comments by menu item ordered by createdAt", async () => {
    await addComment("item1", "第一条", false);
    await addComment("item1", "第二条", false);
    const comments = await getCommentsByMenuItem("item1");
    expect(comments).toHaveLength(2);
    expect(comments[0].content).toBe("第一条");
    expect(comments[1].content).toBe("第二条");
  });

  it("should delete own comment", async () => {
    const comment = await addComment("item1", "要删除的评论", false);
    await deleteComment(comment.id);
    const comments = await getCommentsByMenuItem("item1");
    expect(comments).toHaveLength(0);
  });

  it("should count comments per menu item", async () => {
    await addComment("item1", "评论1", false);
    await addComment("item1", "评论2", false);
    await addComment("item2", "评论3", false);
    const counts = await getCommentsCountByMenuItems(["item1", "item2", "item3"]);
    expect(counts["item1"]).toBe(2);
    expect(counts["item2"]).toBe(1);
    expect(counts["item3"]).toBe(0);
  });

  it("should return empty array for menu item with no comments", async () => {
    const comments = await getCommentsByMenuItem("nonexistent");
    expect(comments).toHaveLength(0);
  });

  it("should reject empty content", async () => {
    await expect(addComment("item1", "   ", false)).rejects.toThrow("评论内容不能为空");
  });

  it("should reject content exceeding max length", async () => {
    const longContent = "a".repeat(2001);
    await expect(addComment("item1", longContent, false)).rejects.toThrow("2000");
  });

  it("should reject deleting another user's comment", async () => {
    // Add comment as current user, then switch identity
    const comment = await addComment("item1", "别人的评论", false);

    // Switch to a different profile
    const otherProfile: Profile = {
      id: "profile_other",
      spaceId: testSpace.id,
      nickname: "其他用户",
      joinedAt: Date.now(),
    };
    saveLocalIdentity({ space: testSpace, profile: otherProfile });

    await expect(deleteComment(comment.id)).rejects.toThrow("只能删除自己的评论");
  });

  it("should reject operations without space identity", async () => {
    localStorage.removeItem("hyet_profile_v1");
    localStorage.removeItem("hyet_space_v1");
    await expect(addComment("item1", "test", false)).rejects.toThrow("请先加入或创建空间");
  });
});
