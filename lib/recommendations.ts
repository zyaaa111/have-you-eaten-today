import { db } from "./db";
import type { MenuItem, MenuItemKind } from "./types";
import { getAvoidedIds } from "./avoidances";
import { getFavoriteIds } from "./favorites";
import { getLikesCountByMenuItems } from "./likes";
import { getCommentsCountByMenuItems } from "./comments";
import { getWeightsMap } from "./weights";
import { getWishIds } from "./wishlist";

export interface RecommendationItem {
  item: MenuItem;
  score: number;
  reasons: string[];
}

interface RecommendationOptions {
  kind?: MenuItemKind;
  tagIds?: string[];
  menuItemIds?: string[];
  limit?: number;
}

function applyFilters(items: MenuItem[], options: RecommendationOptions): MenuItem[] {
  return items.filter((item) => {
    if (options.kind && item.kind !== options.kind) return false;
    if (options.menuItemIds && options.menuItemIds.length > 0 && !options.menuItemIds.includes(item.id)) return false;
    if (options.tagIds && options.tagIds.length > 0 && !options.tagIds.some((tagId) => item.tags.includes(tagId))) {
      return false;
    }
    return true;
  });
}

async function getRecentHistoryPenaltyMap(): Promise<Map<string, number>> {
  const history = await db.rollHistory.orderBy("rolledAt").reverse().limit(50).toArray();
  const penalties = new Map<string, number>();
  const now = Date.now();

  for (const entry of history) {
    const ageDays = (now - entry.rolledAt) / (24 * 60 * 60 * 1000);
    const penalty = ageDays <= 3 ? 6 : ageDays <= 7 ? 3 : ageDays <= 14 ? 1 : 0;
    if (penalty <= 0) continue;
    for (const item of entry.items) {
      penalties.set(item.menuItemId, Math.max(penalties.get(item.menuItemId) ?? 0, penalty));
    }
  }

  return penalties;
}

export async function getRecommendations(options: RecommendationOptions = {}): Promise<RecommendationItem[]> {
  const allItems = await db.menuItems.toArray();
  const filteredItems = applyFilters(allItems, options);
  if (filteredItems.length === 0) return [];

  const [avoidIds, favoriteIds, wishIds, weightMap, likeCountMap, commentCountMap, penalties] = await Promise.all([
    getAvoidedIds(),
    getFavoriteIds(),
    getWishIds(),
    getWeightsMap(filteredItems.map((item) => item.id)),
    getLikesCountByMenuItems(filteredItems.map((item) => item.id)),
    getCommentsCountByMenuItems(filteredItems.map((item) => item.id)),
    getRecentHistoryPenaltyMap(),
  ]);

  const favoriteSet = new Set(favoriteIds);
  const wishSet = new Set(wishIds);

  return filteredItems
    .filter((item) => !avoidIds.has(item.id))
    .map((item) => {
      const reasons: string[] = [];
      let score = 0;

      const personalWeight = weightMap[item.id] ?? 1;
      score += personalWeight * 2;
      if (personalWeight > 1) {
        reasons.push(`个人权重 ${personalWeight}`);
      }

      if (wishSet.has(item.id)) {
        score += 6;
        reasons.push("近期想吃");
      }

      if (favoriteSet.has(item.id)) {
        score += 3;
        reasons.push("已收藏");
      }

      const likes = likeCountMap[item.id] ?? 0;
      const comments = commentCountMap[item.id] ?? 0;
      if (likes > 0) {
        score += likes;
        reasons.push(`${likes} 个赞`);
      }
      if (comments > 0) {
        score += Math.min(3, comments) * 0.8;
        reasons.push(`${comments} 条评论`);
      }

      const penalty = penalties.get(item.id) ?? 0;
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
