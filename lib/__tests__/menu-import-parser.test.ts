import { describe, it, expect } from "vitest";
import { parseExcelRows } from "../menu-import-parser";
import type { MenuItem, Tag } from "../types";

function makeMenuItem(kind: "recipe" | "takeout", name: string): MenuItem {
  return {
    id: `id-${name}`,
    kind,
    name,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeTag(name: string, type: "cuisine" | "category" | "custom"): Tag {
  return {
    id: `tag-${name}`,
    name,
    type,
    createdAt: Date.now(),
  };
}

const emptyExisting = { menuItems: [] as MenuItem[], tags: [] as Tag[] };

describe("parseExcelRows — normal parsing", () => {
  it("parses a valid recipe row", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "番茄炒蛋" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
    expect(result.toImport[0].kind).toBe("recipe");
    expect(result.toImport[0].name).toBe("番茄炒蛋");
    expect(result.errors).toHaveLength(0);
  });

  it("parses a valid takeout row with shop", () => {
    const result = parseExcelRows(
      [{ 类型: "外卖", 名称: "黄焖鸡", 店铺: "老字号" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
    expect(result.toImport[0].shop).toBe("老字号");
  });

  it("parses tags from all three types", () => {
    const result = parseExcelRows(
      [
        {
          类型: "菜谱",
          名称: "麻婆豆腐",
          菜系标签: "川菜,中餐",
          类别标签: "豆腐",
          自定义标签: "快手菜",
        },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    const row = result.toImport[0];
    expect(row.tagNamesByType.cuisine).toEqual(["川菜", "中餐"]);
    expect(row.tagNamesByType.category).toEqual(["豆腐"]);
    expect(row.tagNamesByType.custom).toEqual(["快手菜"]);
  });

  it("parses ingredients via parseIngredientText", () => {
    const result = parseExcelRows(
      [
        {
          类型: "菜谱",
          名称: "红烧肉",
          材料清单: "五花肉|500|克\n酱油|2|勺",
        },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    const row = result.toImport[0];
    expect(row.ingredients).toHaveLength(2);
    expect(row.ingredients[0].name).toBe("五花肉");
    expect(row.ingredients[0].quantity).toBe(500);
    expect(row.ingredients[0].unit).toBe("克");
  });

  it("parses steps with auto-ordering", () => {
    const result = parseExcelRows(
      [
        {
          类型: "菜谱",
          名称: "炒青菜",
          步骤: "洗菜\n热锅\n炒菜",
        },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    const row = result.toImport[0];
    expect(row.steps).toHaveLength(3);
    expect(row.steps[0]).toEqual({ order: 1, description: "洗菜" });
    expect(row.steps[2]).toEqual({ order: 3, description: "炒菜" });
  });

  it("parses weight correctly", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 权重: "5" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport[0].weight).toBe(5);
  });

  it("defaults weight to 1", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport[0].weight).toBe(1);
  });

  it("rejects weights outside 1-10 instead of changing them silently", () => {
    const r1 = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 权重: "0" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(r1.toImport).toHaveLength(0);
    expect(r1.errors).toHaveLength(1);
    expect(r1.errors[0].message).toContain("1-10");

    const r2 = parseExcelRows(
      [{ 类型: "菜谱", 名称: "B", 权重: "99" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(r2.toImport).toHaveLength(0);
    expect(r2.errors).toHaveLength(1);
    expect(r2.errors[0].message).toContain("1-10");
  });

  it("rejects non-integer weight", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 权重: "1.5" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("整数");
  });

  it("parses tips and shopAddress", () => {
    const result = parseExcelRows(
      [
        {
          类型: "外卖",
          名称: "炸鸡",
          心得: "很好吃",
          店铺: "炸鸡店",
          店铺地址: "xx路xx号",
        },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport[0].tips).toBe("很好吃");
    expect(result.toImport[0].shopAddress).toBe("xx路xx号");
  });
});

describe("parseExcelRows — deduplication", () => {
  it("deduplicates within file (same kind+name)", () => {
    const result = parseExcelRows(
      [
        { 类型: "菜谱", 名称: "番茄炒蛋" },
        { 类型: "菜谱", 名称: "番茄炒蛋" },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("文件内重复");
    expect(result.errors).toHaveLength(0);
  });

  it("allows same name with different kind", () => {
    const result = parseExcelRows(
      [
        { 类型: "菜谱", 名称: "炸鸡" },
        { 类型: "外卖", 名称: "炸鸡", 店铺: "肯德基" },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(2);
  });

  it("deduplicates against existing menu items", () => {
    const existing = [makeMenuItem("recipe", "番茄炒蛋")];
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "番茄炒蛋" }],
      existing,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("数据库已存在");
    expect(result.errors).toHaveLength(0);
  });
});

describe("parseExcelRows — validation errors", () => {
  it("rejects missing kind", () => {
    const result = parseExcelRows(
      [{ 名称: "番茄炒蛋" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("类型");
  });

  it("rejects invalid kind", () => {
    const result = parseExcelRows(
      [{ 类型: "点心", 名称: "虾饺" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("无效");
  });

  it("rejects missing name", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("名称不能为空");
  });

  it("rejects takeout without shop", () => {
    const result = parseExcelRows(
      [{ 类型: "外卖", 名称: "炸鸡" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("店铺");
  });

  it("rejects malformed ingredient lines", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 材料清单: "鸡蛋|3|个\n|2个" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("材料清单第 2 行");
  });

  it("parses English key rows", () => {
    const result = parseExcelRows(
      [{ kind: "recipe", name: "A", weight: "2", ingredients: "鸡蛋|3|个" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
    expect(result.toImport[0].weight).toBe(2);
    expect(result.toImport[0].ingredients).toHaveLength(1);
  });
});

describe("parseExcelRows — tag detection", () => {
  it("detects new tags", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 菜系标签: "川菜,粤菜" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.newTags).toHaveLength(2);
    expect(result.newTags[0]).toEqual({ name: "川菜", type: "cuisine" });
    expect(result.newTags[1]).toEqual({ name: "粤菜", type: "cuisine" });
  });

  it("does not report existing tags as new", () => {
    const existingTags = [makeTag("川菜", "cuisine")];
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 菜系标签: "川菜" }],
      emptyExisting.menuItems,
      existingTags
    );
    expect(result.newTags).toHaveLength(0);
  });

  it("handles Chinese and English comma separators", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 菜系标签: "川菜，粤菜" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.newTags).toHaveLength(2);
  });

  it("deduplicates tags within same type", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A", 菜系标签: "川菜,川菜" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport[0].tagNamesByType.cuisine).toEqual(["川菜"]);
    expect(result.newTags).toHaveLength(1);
  });
});

describe("parseExcelRows — empty rows", () => {
  it("skips empty rows", () => {
    const result = parseExcelRows(
      [
        {},
        { 类型: "菜谱", 名称: "A" },
        {},
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips rows with only whitespace", () => {
    const result = parseExcelRows(
      [
        { 类型: "   ", 名称: "   " },
        { 类型: "菜谱", 名称: "A" },
      ],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport).toHaveLength(1);
  });
});

describe("parseExcelRows — row index", () => {
  it("uses 2-based row index (1 for data + 1 for header)", () => {
    const result = parseExcelRows(
      [{ 类型: "菜谱", 名称: "A" }],
      emptyExisting.menuItems,
      emptyExisting.tags
    );
    expect(result.toImport[0].rowIndex).toBe(2);
  });
});
