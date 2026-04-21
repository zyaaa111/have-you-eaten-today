import { describe, expect, it } from "vitest";
import { clearLocalIdentity, generateInviteCode, getLocalIdentity, saveLocalIdentity } from "../identity";

describe("identity helpers", () => {
  it("should persist and restore local identity", () => {
    saveLocalIdentity({
      profile: {
        id: "profile-1",
        spaceId: "space-1",
        nickname: "测试用户",
        joinedAt: 123,
      },
      space: {
        id: "space-1",
        inviteCode: "ABC123",
        name: "测试空间",
        createdAt: 123,
        updatedAt: 123,
      },
    });

    expect(getLocalIdentity()).toEqual({
      profile: {
        id: "profile-1",
        spaceId: "space-1",
        nickname: "测试用户",
        joinedAt: 123,
      },
      space: {
        id: "space-1",
        inviteCode: "ABC123",
        name: "测试空间",
        createdAt: 123,
        updatedAt: 123,
      },
    });
  });

  it("should clear local identity", () => {
    saveLocalIdentity({
      profile: {
        id: "profile-1",
        spaceId: "space-1",
        nickname: "测试用户",
        joinedAt: 123,
      },
      space: {
        id: "space-1",
        inviteCode: "ABC123",
        name: "测试空间",
        createdAt: 123,
        updatedAt: 123,
      },
    });

    clearLocalIdentity();
    expect(getLocalIdentity()).toBeNull();
  });

  it("should generate a 6-character invite code without ambiguous characters", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});
