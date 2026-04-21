import { db } from "./db-server";
import type { ComboRule, MenuItem, MenuItemKind, RolledItem } from "./types";

export interface SharedRecommendationResult {
  item: MenuItem;
  score: number;
  reasons: string[];
}

export interface SharedRecommendationOptions {
  spaceId: string;
  profileIds: string[];
  kind?: MenuItemKind;
  tagIds?: string[];
  menuItemIds?: string[];
  limit?: number;
  recentHistoryIds?: string[];
}

export interface SharedRollOptions extends SharedRecommendationOptions {
  templateId?: string;
}

interface ProfileSignalMaps {
  avoidCounts: Map<string, number>;
  wishCounts: Map<string, number>;
  weightTotals: Map<string, number>;
}

function parseMenuItems(spaceId: string): MenuItem[] {
  const rows = db.prepare("SELECT * FROM menu_items WHERE space_id = ?").all(spaceId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as MenuItemKind,
    name: String(row.name),
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) as string[] : [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ingredients: row.ingredients ? JSON.parse(String(row.ingredients)) : undefined,
    steps: row.steps ? JSON.parse(String(row.steps)) : undefined,
    tips: row.tips ? String(row.tips) : undefined,
    shop: row.shop ? String(row.shop) : undefined,
    shopAddress: row.shop_address ? String(row.shop_address) : undefined,
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    spaceId: String(row.space_id),
    profileId: String(row.profile_id),
    version: Number(row.version ?? 1),
  }));
}

function filterItems(items: MenuItem[], options: SharedRecommendationOptions): MenuItem[] {
  return items.filter((item) => {
    if (options.kind && item.kind !== options.kind) return false;
    if (options.menuItemIds && options.menuItemIds.length > 0 && !options.menuItemIds.includes(item.id)) return false;
    if (options.tagIds && options.tagIds.length > 0 && !options.tagIds.some((tagId) => item.tags.includes(tagId))) {
      return false;
    }
    return true;
  });
}

function getProfileSignals(spaceId: string, profileIds: string[]): ProfileSignalMaps {
  const avoidCounts = new Map<string, number>();
  const wishCounts = new Map<string, number>();
  const weightTotals = new Map<string, number>();

  if (profileIds.length === 0) {
    return { avoidCounts, wishCounts, weightTotals };
  }

  const placeholders = profileIds.map(() => "?").join(",");
  const avoidRows = db.prepare(
    `SELECT profile_id, menu_item_id
     FROM profile_avoidances
     WHERE space_id = ? AND profile_id IN (${placeholders})`
  ).all(spaceId, ...profileIds) as Array<{ profile_id: string; menu_item_id: string }>;
  const wishRows = db.prepare(
    `SELECT profile_id, menu_item_id
     FROM profile_wishes
     WHERE space_id = ? AND profile_id IN (${placeholders})`
  ).all(spaceId, ...profileIds) as Array<{ profile_id: string; menu_item_id: string }>;
  const weightRows = db.prepare(
    `SELECT profile_id, menu_item_id, weight
     FROM profile_weights
     WHERE space_id = ? AND profile_id IN (${placeholders})`
  ).all(spaceId, ...profileIds) as Array<{ profile_id: string; menu_item_id: string; weight: number }>;

  for (const row of avoidRows) {
    avoidCounts.set(row.menu_item_id, (avoidCounts.get(row.menu_item_id) ?? 0) + 1);
  }
  for (const row of wishRows) {
    wishCounts.set(row.menu_item_id, (wishCounts.get(row.menu_item_id) ?? 0) + 1);
  }
  for (const row of weightRows) {
    weightTotals.set(row.menu_item_id, (weightTotals.get(row.menu_item_id) ?? 0) + Number(row.weight ?? 1));
  }

  return { avoidCounts, wishCounts, weightTotals };
}

function getPublicHeatMaps(spaceId: string): {
  likeCountMap: Map<string, number>;
  commentCountMap: Map<string, number>;
} {
  const likeRows = db.prepare(
    "SELECT menu_item_id, COUNT(*) AS count FROM likes WHERE space_id = ? GROUP BY menu_item_id"
  ).all(spaceId) as Array<{ menu_item_id: string; count: number }>;
  const commentRows = db.prepare(
    "SELECT menu_item_id, COUNT(*) AS count FROM comments WHERE space_id = ? GROUP BY menu_item_id"
  ).all(spaceId) as Array<{ menu_item_id: string; count: number }>;

  return {
    likeCountMap: new Map(likeRows.map((row) => [row.menu_item_id, Number(row.count)])),
    commentCountMap: new Map(commentRows.map((row) => [row.menu_item_id, Number(row.count)])),
  };
}

function buildPenaltyMap(recentHistoryIds: string[] | undefined): Map<string, number> {
  const penalties = new Map<string, number>();
  for (const id of recentHistoryIds ?? []) {
    penalties.set(id, 3);
  }
  return penalties;
}

export function getSharedRecommendations(options: SharedRecommendationOptions): SharedRecommendationResult[] {
  const filteredItems = filterItems(parseMenuItems(options.spaceId), options);
  if (filteredItems.length === 0) return [];

  const participantCount = Math.max(options.profileIds.length, 1);
  const signals = getProfileSignals(options.spaceId, options.profileIds);
  const { likeCountMap, commentCountMap } = getPublicHeatMaps(options.spaceId);
  const penalties = buildPenaltyMap(options.recentHistoryIds);

  return filteredItems
    .filter((item) => (signals.avoidCounts.get(item.id) ?? 0) === 0)
    .map((item) => {
      const wishCount = signals.wishCounts.get(item.id) ?? 0;
      const weightTotal = signals.weightTotals.get(item.id) ?? 0;
      const averageWeight = weightTotal > 0 ? weightTotal / participantCount : 1;
      const likes = likeCountMap.get(item.id) ?? 0;
      const comments = commentCountMap.get(item.id) ?? 0;
      const penalty = penalties.get(item.id) ?? 0;
      const reasons: string[] = [];

      let score = averageWeight * 2;
      if (averageWeight > 1) {
        reasons.push(`${Math.min(wishCount || participantCount, participantCount)}/${participantCount} 成员偏好较高`);
      }
      if (wishCount > 0) {
        score += wishCount * 2.5;
        reasons.push("近期有人想吃");
      }
      if (likes > 0) {
        score += likes;
        reasons.push(`${likes} 个赞`);
      }
      if (comments > 0) {
        score += Math.min(3, comments) * 0.8;
        reasons.push(`${comments} 条评论`);
      }
      if (penalty > 0) {
        score -= penalty;
        reasons.push("近期抽中过");
      }

      return {
        item,
        score,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 6);
}

function weightedPick<T extends { score: number }>(items: T[]): T | null {
  const normalized = items.map((item) => ({ ...item, weight: Math.max(0.2, item.score) }));
  const total = normalized.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  let cursor = Math.random() * total;
  for (const item of normalized) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return normalized[normalized.length - 1] ?? null;
}

function toRolledItem(item: MenuItem): RolledItem {
  return {
    menuItemId: item.id,
    name: item.name,
    kind: item.kind,
    shop: item.shop,
  };
}

function parseTemplateRules(spaceId: string, templateId: string): ComboRule[] {
  const row = db.prepare(
    "SELECT rules FROM combo_templates WHERE id = ? AND space_id = ? LIMIT 1"
  ).get(templateId, spaceId) as { rules: string } | undefined;
  if (!row) return [];
  return JSON.parse(row.rules) as ComboRule[];
}

export function rollSharedRecommendations(options: SharedRollOptions): { items: RolledItem[]; ruleSnapshot: string; ignoredDedup: boolean } | null {
  if (options.templateId) {
    const rules = parseTemplateRules(options.spaceId, options.templateId);
    if (rules.length === 0) return null;
    const selectedIds = new Set<string>();
    const rolledItems: RolledItem[] = [];

    for (const rule of rules) {
      const candidates = getSharedRecommendations({
        ...options,
        kind: rule.kind,
        tagIds: rule.tagIds,
        menuItemIds: options.menuItemIds?.filter((menuItemId) => !selectedIds.has(menuItemId)),
        limit: 50,
      }).filter((entry) => !selectedIds.has(entry.item.id));

      const count = Math.min(rule.count, candidates.length);
      const mutableCandidates = [...candidates];
      for (let index = 0; index < count; index++) {
        const picked = weightedPick(mutableCandidates);
        if (!picked) break;
        selectedIds.add(picked.item.id);
        rolledItems.push(toRolledItem(picked.item));
        const nextIndex = mutableCandidates.findIndex((entry) => entry.item.id === picked.item.id);
        if (nextIndex >= 0) {
          mutableCandidates.splice(nextIndex, 1);
        }
      }
    }

    if (rolledItems.length === 0) return null;
    return {
      items: rolledItems,
      ruleSnapshot: "多人组合抽选",
      ignoredDedup: false,
    };
  }

  const [picked] = getSharedRecommendations({ ...options, limit: 12 });
  if (!picked) return null;
  return {
    items: [toRolledItem(picked.item)],
    ruleSnapshot: "多人抽选",
    ignoredDedup: false,
  };
}
