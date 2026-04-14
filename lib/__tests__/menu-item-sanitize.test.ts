import { describe, expect, it } from "vitest";
import { buildMenuItemRestorePayload, sanitizeMenuItemSnapshot } from "@/lib/menu-item-sanitize";

describe("menu item sanitize helpers", () => {
  it("should strip legacy weight from menu item snapshots returned by history APIs", () => {
    const snapshot = sanitizeMenuItemSnapshot({
      id: "menu_1",
      kind: "recipe",
      name: "溏心蛋",
      tags: "[\"egg\"]",
      weight: 6,
      ingredients: "[{\"name\":\"鸡蛋\",\"amount\":\"2个\"}]",
      steps: "[{\"order\":1,\"description\":\"煮蛋\"}]",
    });

    expect(snapshot).not.toBeNull();
    expect((snapshot as { weight?: number }).weight).toBeUndefined();
    expect(snapshot?.tags).toEqual(["egg"]);
    expect(snapshot?.ingredients).toEqual([{ name: "鸡蛋", amount: "2个" }]);
    expect(snapshot?.steps).toEqual([{ order: 1, description: "煮蛋", durationMinutes: undefined }]);
  });

  it("should build a restore payload from shared fields only", () => {
    const payload = buildMenuItemRestorePayload({
      id: "menu_1",
      kind: "takeout",
      name: "酸辣粉",
      tags: ["night"],
      weight: 10,
      createdAt: 123,
      shop: "楼下小店",
      shopAddress: "一楼档口",
      ingredients: [{ name: "不该恢复" }],
      steps: [{ order: 1, description: "不该恢复" }],
      tips: "不该恢复",
    });

    expect((payload as { weight?: number }).weight).toBeUndefined();
    expect(payload).toMatchObject({
      kind: "takeout",
      name: "酸辣粉",
      tags: ["night"],
      createdAt: 123,
      shop: "楼下小店",
      shopAddress: "一楼档口",
    });
    expect(payload.ingredients).toBeUndefined();
    expect(payload.steps).toBeUndefined();
    expect(payload.tips).toBeUndefined();
  });
});
