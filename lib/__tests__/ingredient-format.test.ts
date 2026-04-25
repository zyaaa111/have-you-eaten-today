import { describe, it, expect } from "vitest";
import { formatIngredientText } from "../ingredient-format";
import type { SummaryLine } from "../ingredient-summary";
import type { RolledItem } from "../types";

const FIXED_TS = new Date("2026-04-24T12:30:00").getTime();

function makeItems(overrides: Partial<RolledItem>[] = []): RolledItem[] {
  return overrides.map((o, i) => ({
    menuItemId: `id-${i}`,
    name: o.name ?? `菜${i}`,
    kind: o.kind ?? "recipe",
    ...o,
  }));
}

describe("formatIngredientText", () => {
  it("formats precise-only summary", () => {
    const summary: SummaryLine[] = [
      { name: "鸡蛋", totalQuantity: 5, unit: "个", amount: "5个", sources: ["番茄炒蛋", "蛋花汤"], merged: true },
      { name: "番茄", totalQuantity: 3, unit: "个", amount: "3个", sources: ["番茄炒蛋"], merged: true },
    ];
    const items = makeItems([{ name: "番茄炒蛋" }, { name: "蛋花汤" }]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("材料清单（2026-04-24 12:30）");
    expect(result).toContain("── 精确汇总 ──");
    expect(result).toContain("鸡蛋 5个");
    expect(result).toContain("番茄 3个");
    expect(result).not.toContain("── 需分别准备 ──");
    expect(result).not.toContain("── 说明 ──");
  });

  it("formats vague-only summary", () => {
    const summary: SummaryLine[] = [
      { name: "盐", amount: "少许", sources: ["番茄炒蛋"], merged: false },
      { name: "生抽", amount: "适量", sources: ["红烧肉"], merged: false },
    ];
    const items = makeItems([{ name: "番茄炒蛋" }, { name: "红烧肉" }]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("── 需分别准备 ──");
    expect(result).toContain("盐 少许（番茄炒蛋）");
    expect(result).toContain("生抽 适量（红烧肉）");
    expect(result).not.toContain("── 精确汇总 ──");
  });

  it("formats mixed precise and vague summary", () => {
    const summary: SummaryLine[] = [
      { name: "鸡蛋", totalQuantity: 5, unit: "个", amount: "5个", sources: ["番茄炒蛋"], merged: true },
      { name: "盐", amount: "少许", sources: ["番茄炒蛋"], merged: false },
    ];
    const items = makeItems([{ name: "番茄炒蛋" }]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("── 精确汇总 ──");
    expect(result).toContain("── 需分别准备 ──");
    expect(result).toContain("鸡蛋 5个");
    expect(result).toContain("盐 少许（番茄炒蛋）");
  });

  it("includes takeout note when items contain takeout", () => {
    const summary: SummaryLine[] = [
      { name: "鸡蛋", totalQuantity: 2, unit: "个", amount: "2个", sources: ["番茄炒蛋"], merged: true },
    ];
    const items = makeItems([
      { name: "番茄炒蛋", kind: "recipe" },
      { name: "麦当劳", kind: "takeout" },
    ]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("── 说明 ──");
    expect(result).toContain("本次结果含 1 项外卖，不生成采购材料");
  });

  it("shows only takeout note when summary is empty (all takeout)", () => {
    const summary: SummaryLine[] = [];
    const items = makeItems([
      { name: "肯德基", kind: "takeout" },
      { name: "麦当劳", kind: "takeout" },
    ]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("材料清单（2026-04-24 12:30）");
    expect(result).not.toContain("── 精确汇总 ──");
    expect(result).not.toContain("── 需分别准备 ──");
    expect(result).toContain("── 说明 ──");
    expect(result).toContain("本次结果含 2 项外卖，不生成采购材料");
  });

  it("handles empty items with empty summary", () => {
    const result = formatIngredientText([], { rolledAt: FIXED_TS, items: [] });

    expect(result).toContain("材料清单（2026-04-24 12:30）");
    expect(result).not.toContain("── 精确汇总 ──");
    expect(result).not.toContain("── 需分别准备 ──");
    expect(result).not.toContain("── 说明 ──");
  });

  it("formats vague line without amount", () => {
    const summary: SummaryLine[] = [
      { name: "葱花", sources: ["蛋炒饭"], merged: false },
    ];
    const items = makeItems([{ name: "蛋炒饭" }]);

    const result = formatIngredientText(summary, { rolledAt: FIXED_TS, items });

    expect(result).toContain("葱花（蛋炒饭）");
  });
});
