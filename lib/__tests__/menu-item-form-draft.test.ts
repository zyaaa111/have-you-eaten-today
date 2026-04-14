import { describe, expect, it } from "vitest";
import {
  buildMenuItemFormDraft,
  parseMenuItemFormDraft,
  resolveDraftWeight,
} from "@/lib/menu-item-form-draft";

describe("menu item form draft helpers", () => {
  it("should persist weight in the serialized draft payload", () => {
    const payload = buildMenuItemFormDraft({
      kind: "recipe",
      name: "番茄炒蛋",
      tags: ["tag-1"],
      weight: 7,
      ingredients: [{ name: "鸡蛋", amount: "3个" }],
      steps: [{ order: 1, description: "搅拌" }],
      tips: "少许盐",
      shop: undefined,
      shopAddress: undefined,
      imageUrl: undefined,
    });

    const parsed = parseMenuItemFormDraft(JSON.stringify(payload));

    expect(parsed?.weight).toBe(7);
    expect(parsed?.name).toBe("番茄炒蛋");
  });

  it("should resolve weight from draft before saved value and default", () => {
    expect(resolveDraftWeight(8, 3)).toBe(8);
    expect(resolveDraftWeight(undefined, 4)).toBe(4);
    expect(resolveDraftWeight(undefined, undefined)).toBe(1);
  });
});
