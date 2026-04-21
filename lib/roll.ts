import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { MenuItem, MenuItemKind, RolledItem, ComboTemplate } from "./types";
import { getDefaultDedupDays, getDedupEnabled } from "./settings";
import { getWishIds } from "./wishlist";
import { getAvoidedIds } from "./avoidances";
import { getWeightsMap } from "./weights";
import { scheduleProfileStateSync } from "./profile-state";

export interface SingleRollOptions {
  kind?: MenuItemKind;
  tagIds?: string[];
  dedupDays?: number;
  ignoreDedup?: boolean;
}

export interface ComboRollOptions {
  templateId: string;
  dedupDays?: number;
  ignoreDedup?: boolean;
}

export interface RollResult {
  items: RolledItem[];
  ruleSnapshot: string;
  ignoredDedup: boolean;
}

function weightedPick<T extends { weight: number }>(items: T[]): T | null {
  const total = items.reduce((sum, i) => sum + Math.max(0, i.weight || 1), 0);
  if (total <= 0 || items.length === 0) return null;
  let rand = Math.random() * total;
  for (const item of items) {
    rand -= Math.max(0, item.weight || 1);
    if (rand <= 0) return item;
  }
  return items[items.length - 1];
}

async function getRecentRolledIds(dedupDays = 7): Promise<Set<string>> {
  const since = Date.now() - dedupDays * 24 * 60 * 60 * 1000;
  const history = await db.rollHistory.where("rolledAt").above(since).toArray();
  const ids = new Set<string>();
  for (const h of history) {
    for (const item of h.items) {
      ids.add(item.menuItemId);
    }
  }
  return ids;
}

function filterMenuItems(
  items: MenuItem[],
  kind?: MenuItemKind,
  tagIds?: string[]
): MenuItem[] {
  return items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (tagIds && tagIds.length > 0) {
      if (!tagIds.some((id) => item.tags.includes(id))) return false;
    }
    return true;
  });
}

function buildSingleRuleSnapshot(opts: SingleRollOptions): string {
  const parts: string[] = [];
  if (opts.kind) {
    parts.push(opts.kind === "recipe" ? "菜谱" : "外卖");
  } else {
    parts.push("全部");
  }
  if (opts.tagIds && opts.tagIds.length > 0) {
    parts.push(`标签筛选(${opts.tagIds.length})`);
  }
  return parts.join(" · ");
}

export async function rollSingle(opts: SingleRollOptions): Promise<RollResult | null> {
  const allItems = await db.menuItems.toArray();
  let candidates = filterMenuItems(allItems, opts.kind, opts.tagIds);
  if (candidates.length === 0) return null;

  const dedupEnabled = await getDedupEnabled();
  const dedupDays = opts.dedupDays ?? await getDefaultDedupDays();
  const dedupIds = (!dedupEnabled || opts.ignoreDedup) ? new Set<string>() : await getRecentRolledIds(dedupDays);
  const avoidedIds = await getAvoidedIds();
  let pool = candidates.filter((i) => !dedupIds.has(i.id) && !avoidedIds.has(i.id));

  let ignoredDedup = false;
  if (pool.length === 0 && !opts.ignoreDedup) {
    pool = candidates.filter((i) => !avoidedIds.has(i.id));
    ignoredDedup = true;
  }

  const wishIds = await getWishIds();
  const wishBoost = 3;
  const weightsMap = await getWeightsMap(pool.map((i) => i.id));
  const boostedPool = pool.map((item) => ({
    ...item,
    weight: weightsMap[item.id] * (wishIds.includes(item.id) ? wishBoost : 1),
  }));

  const picked = weightedPick(boostedPool);
  if (!picked) return null;

  const rolledItem: RolledItem = {
    menuItemId: picked.id,
    name: picked.name,
    kind: picked.kind,
    shop: picked.shop,
  };

  const result: RollResult = {
    items: [rolledItem],
    ruleSnapshot: buildSingleRuleSnapshot(opts),
    ignoredDedup,
  };

  const historyId = uuidv4();
  await db.rollHistory.add({
    id: historyId,
    rolledAt: Date.now(),
    items: result.items,
    ruleSnapshot: result.ruleSnapshot,
    ignoredDedup: result.ignoredDedup,
  });
  scheduleProfileStateSync({ collection: "rollHistory", key: historyId });

  return result;
}

export async function rollCombo(opts: ComboRollOptions): Promise<RollResult | null> {
  const template = await db.comboTemplates.get(opts.templateId);
  if (!template) return null;

  const allItems = await db.menuItems.toArray();
  const dedupEnabled = await getDedupEnabled();
  const dedupDays = opts.dedupDays ?? await getDefaultDedupDays();
  const dedupIds = (!dedupEnabled || opts.ignoreDedup) ? new Set<string>() : await getRecentRolledIds(dedupDays);
  const avoidedIds = await getAvoidedIds();
  const selectedIds = new Set<string>();
  const rolledItems: RolledItem[] = [];
  let didFallback = false;
  const wishIds = await getWishIds();
  const wishBoost = 3;
  const allWeightsMap = await getWeightsMap(allItems.map((i) => i.id));

  for (const rule of template.rules) {
    const applyRuleFilters = (pool: MenuItem[]) =>
      pool.filter((item) => {
        if (rule.kind && item.kind !== rule.kind) return false;
        if (rule.tagIds && rule.tagIds.length > 0) {
          if (!rule.tagIds.some((id) => item.tags.includes(id))) return false;
        }
        if (rule.shop && item.shop !== rule.shop) return false;
        return true;
      });

    let candidates = applyRuleFilters(allItems).filter(
      (i) => !selectedIds.has(i.id) && !dedupIds.has(i.id) && !avoidedIds.has(i.id)
    );

    if (candidates.length < rule.count) {
      candidates = applyRuleFilters(allItems).filter((i) => !selectedIds.has(i.id) && !avoidedIds.has(i.id));
      if (candidates.length > 0) didFallback = true;
    }

    let boostedCandidates = candidates.map((item) => ({
      ...item,
      weight: allWeightsMap[item.id] * (wishIds.includes(item.id) ? wishBoost : 1),
    }));

    const count = Math.min(rule.count, boostedCandidates.length);
    for (let i = 0; i < count; i++) {
      const picked = weightedPick(boostedCandidates);
      if (!picked) break;
      selectedIds.add(picked.id);
      rolledItems.push({
        menuItemId: picked.id,
        name: picked.name,
        kind: picked.kind,
        shop: picked.shop,
      });
      boostedCandidates = boostedCandidates.filter((c) => c.id !== picked.id);
    }
  }

  if (rolledItems.length === 0) return null;

  const ignoredDedup = opts.ignoreDedup || didFallback;
  const result: RollResult = {
    items: rolledItems,
    ruleSnapshot: template.name,
    ignoredDedup,
  };

  const historyId = uuidv4();
  await db.rollHistory.add({
    id: historyId,
    rolledAt: Date.now(),
    items: result.items,
    ruleSnapshot: result.ruleSnapshot,
    ignoredDedup: result.ignoredDedup,
  });
  scheduleProfileStateSync({ collection: "rollHistory", key: historyId });

  return result;
}

export async function getRollHistory(limit = 200): Promise<ReturnType<typeof db.rollHistory.toArray> extends Promise<infer T> ? T : never> {
  return db.rollHistory.orderBy("rolledAt").reverse().limit(limit).toArray();
}

export async function clearRollHistory(): Promise<void> {
  await db.rollHistory.clear();
  scheduleProfileStateSync({ collection: "rollHistory", reset: true });
}
