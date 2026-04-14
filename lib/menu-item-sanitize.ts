import type { Ingredient, MenuItem, MenuItemKind, RecipeStep } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function toMenuItemKind(value: unknown): MenuItemKind | undefined {
  return value === "recipe" || value === "takeout" ? value : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter((item): item is string => typeof item === "string");
}

function toIngredients(value: unknown): Ingredient[] | undefined {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return undefined;

  return parsed.reduce<Ingredient[]>((items, item) => {
    if (!isRecord(item) || typeof item.name !== "string") return items;
    items.push({
      name: item.name,
      amount: typeof item.amount === "string" && item.amount.length > 0 ? item.amount : undefined,
    });
    return items;
  }, []);
}

function toRecipeSteps(value: unknown): RecipeStep[] | undefined {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return undefined;

  return parsed.reduce<RecipeStep[]>((steps, item, index) => {
    if (!isRecord(item) || typeof item.description !== "string") return steps;
    steps.push({
      order: typeof item.order === "number" && Number.isFinite(item.order) ? item.order : index + 1,
      description: item.description,
      durationMinutes:
        typeof item.durationMinutes === "number" && Number.isFinite(item.durationMinutes)
          ? item.durationMinutes
          : undefined,
    });
    return steps;
  }, []);
}

export function sanitizeMenuItemRecord<T extends Record<string, unknown>>(record: T): Omit<T, "weight"> {
  const next = { ...record } as T & { weight?: unknown };
  delete next.weight;
  return next;
}

export function sanitizeMenuItemSnapshot(
  snapshot: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!snapshot) return null;

  const normalized = { ...sanitizeMenuItemRecord(snapshot) };

  const tags = toStringArray(normalized.tags);
  if (tags !== undefined) {
    normalized.tags = tags;
  }

  const ingredients = toIngredients(normalized.ingredients);
  if (ingredients !== undefined) {
    normalized.ingredients = ingredients;
  }

  const steps = toRecipeSteps(normalized.steps);
  if (steps !== undefined) {
    normalized.steps = steps;
  }

  return normalized;
}

export function buildMenuItemRestorePayload(snapshot: Record<string, unknown>): Partial<MenuItem> {
  const normalized = sanitizeMenuItemSnapshot(snapshot);
  if (!normalized) return {};

  const payload: Partial<MenuItem> = {};
  const kind = toMenuItemKind(normalized.kind);
  if (kind) {
    payload.kind = kind;
  }

  if (typeof normalized.name === "string") {
    payload.name = normalized.name;
  }

  const tags = toStringArray(normalized.tags);
  if (tags !== undefined) {
    payload.tags = tags;
  }

  const createdAt = toFiniteNumber(normalized.createdAt);
  if (createdAt !== undefined) {
    payload.createdAt = createdAt;
  }

  if (hasOwn(normalized, "imageUrl")) {
    payload.imageUrl = typeof normalized.imageUrl === "string" && normalized.imageUrl.length > 0
      ? normalized.imageUrl
      : undefined;
  }

  if (kind === "recipe") {
    if (hasOwn(normalized, "ingredients")) {
      payload.ingredients = toIngredients(normalized.ingredients);
    }
    if (hasOwn(normalized, "steps")) {
      payload.steps = toRecipeSteps(normalized.steps);
    }
    if (hasOwn(normalized, "tips")) {
      payload.tips = typeof normalized.tips === "string" && normalized.tips.length > 0 ? normalized.tips : undefined;
    }
    payload.shop = undefined;
    payload.shopAddress = undefined;
  } else if (kind === "takeout") {
    if (hasOwn(normalized, "shop")) {
      payload.shop = typeof normalized.shop === "string" && normalized.shop.length > 0 ? normalized.shop : undefined;
    }
    if (hasOwn(normalized, "shopAddress")) {
      payload.shopAddress =
        typeof normalized.shopAddress === "string" && normalized.shopAddress.length > 0
          ? normalized.shopAddress
          : undefined;
    }
    payload.ingredients = undefined;
    payload.steps = undefined;
    payload.tips = undefined;
  }

  return payload;
}
