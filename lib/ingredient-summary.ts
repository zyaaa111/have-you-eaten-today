import type { RolledItem } from "./types";

export interface SummaryLine {
  name: string;
  totalQuantity?: number;
  unit?: string;
  amount?: string;
  sources: string[];
  merged: boolean;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function summarizeIngredients(items: RolledItem[]): SummaryLine[] {
  const recipeItems = items.filter(
    (item) => item.kind === "recipe" && item.ingredientSnapshot && item.ingredientSnapshot.length > 0
  );

  if (recipeItems.length === 0) return [];

  // Group precise ingredients by normalized name + unit
  const preciseGroups = new Map<string, { name: string; unit: string; total: number; sources: string[] }>();
  const vagueLines: SummaryLine[] = [];

  for (const item of recipeItems) {
    const snapshot = item.ingredientSnapshot!;
    for (const ing of snapshot) {
      if (
        typeof ing.quantity === "number" &&
        Number.isFinite(ing.quantity) &&
        typeof ing.unit === "string" &&
        ing.unit.length > 0
      ) {
        // Precise ingredient — try to merge
        const key = `${normalizeName(ing.name)}::${ing.unit}`;
        const existing = preciseGroups.get(key);
        if (existing) {
          existing.total += ing.quantity;
          if (!existing.sources.includes(item.name)) {
            existing.sources.push(item.name);
          }
        } else {
          preciseGroups.set(key, {
            name: ing.name,
            unit: ing.unit,
            total: ing.quantity,
            sources: [item.name],
          });
        }
      } else {
        // Vague / unmergeable — keep as separate line
        vagueLines.push({
          name: ing.name,
          amount: ing.amount,
          sources: [item.name],
          merged: false,
        });
      }
    }
  }

  // Build precise summary lines
  const preciseLines: SummaryLine[] = Array.from(preciseGroups.values()).map((group) => ({
    name: group.name,
    totalQuantity: group.total,
    unit: group.unit,
    amount: `${group.total}${group.unit}`,
    sources: group.sources,
    merged: true,
  }));

  return [...preciseLines, ...vagueLines];
}
