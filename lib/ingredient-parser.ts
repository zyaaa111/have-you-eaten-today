import type { Ingredient } from "./types";

const PRECISE_UNITS = new Set([
  "个", "只", "条", "片", "块", "根", "把", "勺", "汤匙", "茶匙",
  "克", "g", "kg", "斤", "两", "磅", "lb", "oz",
  "毫升", "ml", "L", "升",
  "厘米", "cm", "寸", "根",
  "瓣", "粒", "颗", "滴", "杯", "碗", "袋", "盒", "罐", "瓶", "包",
]);

const VAGUE_QUANTIFIERS = new Set([
  "少许", "适量", "若干", "一小撮", "一撮", "一点", "一些", "少量", "微量",
  "若干", "酌量", "依个人口味", "按需", "少许许",
]);

const TRAILING_UNIT_RE = /^(.+?)\s+(\d+(?:\.\d+)?)\s*([^\d\s].*)$/;
const QUANTITY_UNIT_RE = /^(\d+(?:\.\d+)?)\s*(.*)$/;

export function parseIngredientLine(line: string): Ingredient | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  // Pipe-separated: "name|amount" or "name|quantity|unit"
  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((s) => s.trim());
    if (parts.length < 2 || parts[0].length === 0) return null;

    const name = parts[0];

    if (parts.length === 3) {
      // "鸡蛋|3|个"
      const num = Number(parts[1]);
      const unit = parts[2];
      if (Number.isFinite(num) && unit.length > 0 && PRECISE_UNITS.has(unit)) {
        return { name, amount: `${num}${unit}`, quantity: num, unit };
      }
      // "盐|适量|" or "盐|3|xyz" (unknown unit)
      return { name, amount: parts.slice(1).filter(Boolean).join("") || undefined };
    }

    // 2 parts: "五花肉|500g" or "盐|适量"
    const rest = parts[1];
    if (VAGUE_QUANTIFIERS.has(rest)) {
      return { name, amount: rest };
    }
    const match = QUANTITY_UNIT_RE.exec(rest);
    if (match) {
      const num = Number(match[1]);
      const unit = match[2].trim();
      if (Number.isFinite(num) && unit.length > 0 && PRECISE_UNITS.has(unit)) {
        return { name, amount: `${num}${unit}`, quantity: num, unit };
      }
      return { name, amount: rest };
    }
    return { name, amount: rest.length > 0 ? rest : undefined };
  }

  // No pipe: try "name quantity unit" pattern like "生抽 2勺"
  const trailingMatch = TRAILING_UNIT_RE.exec(trimmed);
  if (trailingMatch) {
    const name = trailingMatch[1].trim();
    const num = Number(trailingMatch[2]);
    const unit = trailingMatch[3].trim();
    if (name.length > 0 && Number.isFinite(num) && PRECISE_UNITS.has(unit)) {
      return { name, amount: `${num}${unit}`, quantity: num, unit };
    }
  }

  // Just a name: "葱花"
  return { name: trimmed };
}

export function parseIngredientText(text: string): Ingredient[] {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map(parseIngredientLine)
    .filter((item): item is Ingredient => item !== null);
}

export interface IngredientParseError {
  lineNumber: number;
  line: string;
  message: string;
}

export function parseIngredientTextWithErrors(text: string): {
  ingredients: Ingredient[];
  errors: IngredientParseError[];
} {
  if (typeof text !== "string" || text.length === 0) {
    return { ingredients: [], errors: [] };
  }

  const ingredients: Ingredient[] = [];
  const errors: IngredientParseError[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parsed = parseIngredientLine(trimmed);
    if (!parsed) {
      errors.push({
        lineNumber: index + 1,
        line: trimmed,
        message: "材料格式不正确，请填写材料名，例如「鸡蛋|3|个」",
      });
      return;
    }

    ingredients.push(parsed);
  });

  return { ingredients, errors };
}
