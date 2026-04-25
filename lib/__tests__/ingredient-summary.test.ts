import { describe, it, expect } from "vitest";
import { summarizeIngredients } from "@/lib/ingredient-summary";
import type { RolledItem } from "@/lib/types";

describe("summarizeIngredients", () => {
  it("returns empty array for empty input", () => {
    expect(summarizeIngredients([])).toEqual([]);
  });

  it("returns empty array for all takeout items", () => {
    const items: RolledItem[] = [
      { menuItemId: "1", name: "麻辣烫", kind: "takeout", shop: "小店" },
      { menuItemId: "2", name: "炸鸡", kind: "takeout", shop: "KFC" },
    ];
    expect(summarizeIngredients(items)).toEqual([]);
  });

  it("returns empty array for recipe items without ingredientSnapshot", () => {
    const items: RolledItem[] = [
      { menuItemId: "1", name: "炒饭", kind: "recipe" },
    ];
    expect(summarizeIngredients(items)).toEqual([]);
  });

  it("merges same-name same-unit ingredients", () => {
    const items: RolledItem[] = [
      {
        menuItemId: "1",
        name: "番茄炒蛋",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "鸡蛋", quantity: 3, unit: "个", amount: "3个" },
          { name: "番茄", quantity: 2, unit: "个", amount: "2个" },
        ],
      },
      {
        menuItemId: "2",
        name: "蛋炒饭",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "鸡蛋", quantity: 2, unit: "个", amount: "2个" },
        ],
      },
    ];

    const result = summarizeIngredients(items);
    const eggLine = result.find((l) => l.name === "鸡蛋");
    expect(eggLine).toBeDefined();
    expect(eggLine!.merged).toBe(true);
    expect(eggLine!.totalQuantity).toBe(5);
    expect(eggLine!.unit).toBe("个");
    expect(eggLine!.sources).toContain("番茄炒蛋");
    expect(eggLine!.sources).toContain("蛋炒饭");
  });

  it("does not merge same-name different-unit ingredients", () => {
    const items: RolledItem[] = [
      {
        menuItemId: "1",
        name: "红烧肉",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "生抽", quantity: 2, unit: "勺", amount: "2勺" },
        ],
      },
      {
        menuItemId: "2",
        name: "凉拌菜",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "生抽", quantity: 15, unit: "ml", amount: "15ml" },
        ],
      },
    ];

    const result = summarizeIngredients(items);
    const soyLines = result.filter((l) => l.name === "生抽");
    expect(soyLines).toHaveLength(2);
    expect(soyLines[0].merged).toBe(true);
    expect(soyLines[1].merged).toBe(true);
    expect(soyLines[0].unit).not.toBe(soyLines[1].unit);
  });

  it("keeps ingredients without quantity as separate vague lines", () => {
    const items: RolledItem[] = [
      {
        menuItemId: "1",
        name: "番茄炒蛋",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "盐", amount: "适量" },
          { name: "葱花", amount: "少许" },
        ],
      },
    ];

    const result = summarizeIngredients(items);
    expect(result).toHaveLength(2);
    expect(result.every((l) => !l.merged)).toBe(true);
    expect(result[0].name).toBe("盐");
    expect(result[1].name).toBe("葱花");
  });

  it("attaches correct source dish names", () => {
    const items: RolledItem[] = [
      {
        menuItemId: "1",
        name: "红烧肉",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "冰糖", quantity: 30, unit: "g", amount: "30g" },
        ],
      },
    ];

    const result = summarizeIngredients(items);
    expect(result[0].sources).toEqual(["红烧肉"]);
  });

  it("deduplicates source names when same dish appears twice", () => {
    const items: RolledItem[] = [
      {
        menuItemId: "1",
        name: "番茄炒蛋",
        kind: "recipe",
        ingredientSnapshot: [
          { name: "鸡蛋", quantity: 3, unit: "个", amount: "3个" },
          { name: "鸡蛋", quantity: 2, unit: "个", amount: "2个" },
        ],
      },
    ];

    const result = summarizeIngredients(items);
    const eggLine = result.find((l) => l.name === "鸡蛋");
    expect(eggLine!.sources).toEqual(["番茄炒蛋"]);
    expect(eggLine!.totalQuantity).toBe(5);
  });
});
