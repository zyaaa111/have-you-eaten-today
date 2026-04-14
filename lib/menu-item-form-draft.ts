import type { MenuItem } from "./types";

export type MenuItemFormDraft = Partial<MenuItem> & {
  weight?: number;
};

export function parseMenuItemFormDraft(raw: string | null): MenuItemFormDraft | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as MenuItemFormDraft : null;
  } catch {
    return null;
  }
}

export function buildMenuItemFormDraft(
  draft: Omit<MenuItemFormDraft, "weight"> & { weight: number }
): MenuItemFormDraft {
  return {
    ...draft,
    weight: draft.weight,
  };
}

export function resolveDraftWeight(draftWeight?: number, savedWeight?: number): number {
  if (typeof draftWeight === "number") return draftWeight;
  if (typeof savedWeight === "number") return savedWeight;
  return 1;
}
