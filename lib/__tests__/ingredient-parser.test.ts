import { describe, it, expect } from "vitest";
import {
  parseIngredientLine,
  parseIngredientText,
  parseIngredientTextWithErrors,
} from "@/lib/ingredient-parser";

describe("parseIngredientLine", () => {
  it("parses pipe 3-part format: name|quantity|unit", () => {
    const result = parseIngredientLine("鸡蛋|3|个");
    expect(result).toEqual({
      name: "鸡蛋",
      amount: "3个",
      quantity: 3,
      unit: "个",
    });
  });

  it("parses pipe 2-part format with number+unit", () => {
    const result = parseIngredientLine("五花肉|500g");
    expect(result).toEqual({
      name: "五花肉",
      amount: "500g",
      quantity: 500,
      unit: "g",
    });
  });

  it("parses pipe 2-part format with vague quantifier", () => {
    const result = parseIngredientLine("盐|适量");
    expect(result).toEqual({
      name: "盐",
      amount: "适量",
    });
    expect(result!.quantity).toBeUndefined();
    expect(result!.unit).toBeUndefined();
  });

  it("parses name-only format", () => {
    const result = parseIngredientLine("葱花");
    expect(result).toEqual({ name: "葱花" });
  });

  it("returns null for empty string", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("   ")).toBeNull();
  });

  it("parses decimal quantity in pipe 3-part", () => {
    const result = parseIngredientLine("糖|0.5|kg");
    expect(result).toEqual({
      name: "糖",
      amount: "0.5kg",
      quantity: 0.5,
      unit: "kg",
    });
  });

  it("parses no-pipe format with trailing number+unit", () => {
    const result = parseIngredientLine("生抽 2勺");
    expect(result).toEqual({
      name: "生抽",
      amount: "2勺",
      quantity: 2,
      unit: "勺",
    });
  });

  it("handles unknown unit without quantity/unit fields", () => {
    const result = parseIngredientLine("酱油|3|大勺");
    expect(result).toEqual({
      name: "酱油",
      amount: "3大勺",
    });
    expect(result!.quantity).toBeUndefined();
    expect(result!.unit).toBeUndefined();
  });

  it("handles pipe with empty third part as vague", () => {
    const result = parseIngredientLine("胡椒|少许|");
    expect(result).toEqual({
      name: "胡椒",
      amount: "少许",
    });
  });

  it("trims whitespace from all parts", () => {
    const result = parseIngredientLine("  鸡蛋 | 3 | 个  ");
    expect(result).toEqual({
      name: "鸡蛋",
      amount: "3个",
      quantity: 3,
      unit: "个",
    });
  });
});

describe("parseIngredientText", () => {
  it("parses multi-line text", () => {
    const text = "鸡蛋|3|个\n五花肉|500g\n盐|适量\n葱花";
    const results = parseIngredientText(text);
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ name: "鸡蛋", amount: "3个", quantity: 3, unit: "个" });
    expect(results[1]).toEqual({ name: "五花肉", amount: "500g", quantity: 500, unit: "g" });
    expect(results[2]).toEqual({ name: "盐", amount: "适量" });
    expect(results[3]).toEqual({ name: "葱花" });
  });

  it("skips empty lines", () => {
    const text = "鸡蛋|3|个\n\n\n葱花";
    const results = parseIngredientText(text);
    expect(results).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(parseIngredientText("")).toEqual([]);
    expect(parseIngredientText("  \n  \n  ")).toEqual([]);
  });

  it("handles Windows line endings", () => {
    const text = "鸡蛋|3|个\r\n五花肉|500g";
    const results = parseIngredientText(text);
    expect(results).toHaveLength(2);
  });
});

describe("parseIngredientTextWithErrors", () => {
  it("returns ingredients and row errors separately", () => {
    const result = parseIngredientTextWithErrors("鸡蛋|3|个\n|2个\n葱花");

    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0].name).toBe("鸡蛋");
    expect(result.ingredients[1].name).toBe("葱花");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      lineNumber: 2,
      line: "|2个",
    });
  });

  it("keeps parseIngredientText backward-compatible by filtering invalid lines", () => {
    const results = parseIngredientText("鸡蛋|3|个\n|2个");
    expect(results).toHaveLength(1);
  });
});
