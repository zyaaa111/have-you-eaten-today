import Dexie, { Table } from "dexie";
import {
  MenuItem,
  Tag,
  RollHistory,
  ComboTemplate,
  PersonalWeight,
  AppSettingRecord,
  AvoidanceRecord,
  WishRecord,
  FavoriteRecord,
  Like,
  Comment,
  SyncConflict,
  MenuGroup,
  MenuGroupItem,
} from "./types";
import { buildLikeId } from "./like-id";

export const DB_NAME = "HaveYouEatenTodayDB";
export const DB_VERSION = 15;

export interface PendingDeletion {
  id?: number;
  tableName: "menu_items" | "tags" | "combo_templates" | "likes" | "comments";
  recordId: string;
  spaceId: string;
  createdAt: number;
}

export interface TagMapping {
  id?: number;
  spaceId: string;
  aliasId: string;
  canonicalId: string;
}

export class AppDatabase extends Dexie {
  menuItems!: Table<MenuItem, string>;
  tags!: Table<Tag, string>;
  rollHistory!: Table<RollHistory, string>;
  comboTemplates!: Table<ComboTemplate, string>;
  settings!: Table<AppSettingRecord, string>;
  pendingDeletions!: Table<PendingDeletion, number>;
  tagMappings!: Table<TagMapping, number>;
  avoidances!: Table<AvoidanceRecord, number>;
  wishes!: Table<WishRecord, number>;
  favorites!: Table<FavoriteRecord, number>;
  personalWeights!: Table<PersonalWeight, number>;
  likes!: Table<Like, string>;
  comments!: Table<Comment, string>;
  syncConflicts!: Table<SyncConflict, string>;
  menuGroups!: Table<MenuGroup, string>;
  menuGroupItems!: Table<MenuGroupItem, number>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(1).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt",
      tags: "id, name, type, createdAt",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt",
      settings: "key",
    });

    this.version(2).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt",
      tags: "id, name, type, createdAt",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt",
      settings: "key",
    }).upgrade((tx) => {
      return tx.table("menuItems").toCollection().modify((item: Partial<MenuItem>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.profileId) item.profileId = undefined;
        if (!(item as Record<string, unknown>).remoteId) (item as Record<string, unknown>).remoteId = undefined;
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.version) item.version = 1;
      });
    });

    this.version(3).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
    }).upgrade((tx) => {
      const patchMenuItems = tx.table("menuItems").toCollection().modify((item: Partial<MenuItem>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.profileId) item.profileId = undefined;
        if (!(item as Record<string, unknown>).remoteId) (item as Record<string, unknown>).remoteId = undefined;
        if (typeof item.version !== "number") item.version = 1;
      });
      const patchTags = tx.table("tags").toCollection().modify((item: Partial<Tag>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.profileId) item.profileId = undefined;
        if (!(item as Record<string, unknown>).remoteId) (item as Record<string, unknown>).remoteId = undefined;
        if (typeof item.version !== "number") item.version = 1;
      });
      const patchTemplates = tx.table("comboTemplates").toCollection().modify((item: Partial<ComboTemplate>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.profileId) item.profileId = undefined;
        if (!(item as Record<string, unknown>).remoteId) (item as Record<string, unknown>).remoteId = undefined;
        if (typeof item.version !== "number") item.version = 1;
      });
      return Promise.all([patchMenuItems, patchTags, patchTemplates]);
    });

    this.version(4).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
    });

    this.version(5).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
    });

    this.version(6).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
    });

    this.version(7).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
    }).upgrade(async (tx) => {
      const items = await tx.table("menuItems").toArray() as (MenuItem & { weight?: number })[];
      const weightsToAdd: PersonalWeight[] = items
        .filter((item) => typeof item.weight === "number" && item.weight !== 1)
        .map((item) => ({ menuItemId: item.id, weight: item.weight! }));
      if (weightsToAdd.length > 0) {
        await tx.table("personalWeights").bulkAdd(weightsToAdd);
      }
    });

    this.version(8).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
    }).upgrade((tx) => {
      return tx.table("menuItems").toCollection().modify((item: Record<string, unknown>) => {
        delete item.weight;
      });
    });

    this.version(9).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
    }).upgrade((tx) => {
      return tx.table("menuItems").toCollection().modify((item: Record<string, unknown>) => {
        delete item.weight;
      });
    });

    this.version(10).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
    });

    this.version(11).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
    }).upgrade(async (tx) => {
      const likesTable = tx.table("likes");
      const likes = await likesTable.toArray() as Like[];
      if (likes.length === 0) return;

      const normalized = new Map<string, Like>();
      for (const like of likes) {
        const canonicalId = like.spaceId && like.profileId
          ? buildLikeId(like.spaceId, like.menuItemId, like.profileId)
          : like.id;
        const candidate = { ...like, id: canonicalId };
        const existing = normalized.get(canonicalId);
        if (!existing || preferLike(candidate, existing)) {
          normalized.set(canonicalId, candidate);
        }
      }

      await likesTable.clear();
      await likesTable.bulkAdd(Array.from(normalized.values()));
    });

    this.version(12).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
      syncConflicts: "id, spaceId, tableName, recordId, seq, [spaceId+tableName], [spaceId+recordId]",
    });

    this.version(13).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
      syncConflicts: "id, spaceId, tableName, recordId, seq, [spaceId+tableName], [spaceId+recordId]",
      menuGroups: "id, scope, spaceId, updatedAt, sortOrder",
      menuGroupItems: "++id, groupId, menuItemId, [groupId+menuItemId], sortOrder",
    });

    this.version(14).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      wishes: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      favorites: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      personalWeights: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
      syncConflicts: "id, spaceId, tableName, recordId, seq, [spaceId+tableName], [spaceId+recordId]",
      menuGroups: "id, scope, profileId, spaceId, updatedAt, sortOrder, [scope+sortOrder], [profileId+sortOrder]",
      menuGroupItems: "++id, groupId, menuItemId, profileId, spaceId, updatedAt, [groupId+menuItemId], [profileId+groupId], sortOrder",
    }).upgrade(async (tx) => {
      const now = Date.now();
      const legacyScope = getLegacyPrivateScope();
      const [favoriteIdsRecord, wishIdsRecord] = await Promise.all([
        tx.table("settings").get("favoriteIds") as Promise<{ key: string; value: unknown } | undefined>,
        tx.table("settings").get("wishIds") as Promise<{ key: string; value: unknown } | undefined>,
      ]);
      const favoriteIds = Array.isArray(favoriteIdsRecord?.value) ? favoriteIdsRecord.value as string[] : [];
      const wishIds = Array.isArray(wishIdsRecord?.value) ? wishIdsRecord.value as string[] : [];

      await Promise.all([
        tx.table("avoidances").toCollection().modify((item: Partial<AvoidanceRecord>) => {
          item.scope = normalizeLegacyScope(item.scope, legacyScope.scope);
          item.profileId = legacyScope.profileId;
          item.spaceId = legacyScope.spaceId;
          if (typeof item.updatedAt !== "number") item.updatedAt = now;
        }),
        tx.table("personalWeights").toCollection().modify((item: Partial<PersonalWeight>) => {
          item.scope = normalizeLegacyScope(item.scope, legacyScope.scope);
          item.profileId = legacyScope.profileId;
          item.spaceId = legacyScope.spaceId;
          if (typeof item.updatedAt !== "number") item.updatedAt = now;
        }),
        tx.table("menuGroups").toCollection().modify((item: Partial<MenuGroup> & { scope?: "local" | "space" | "profile" }) => {
          item.scope = (item.scope as "local" | "space" | "profile" | undefined) === "space"
            ? "profile"
            : (item.scope ?? legacyScope.scope);
          item.profileId = item.scope === "profile" ? legacyScope.profileId : undefined;
          item.spaceId = item.scope === "profile" ? legacyScope.spaceId : undefined;
          if (typeof item.updatedAt !== "number") item.updatedAt = now;
        }),
        tx.table("menuGroupItems").toCollection().modify((item: Partial<MenuGroupItem>) => {
          item.profileId = legacyScope.profileId;
          item.spaceId = legacyScope.spaceId;
          if (typeof item.updatedAt !== "number") item.updatedAt = now;
        }),
      ]);

      if (favoriteIds.length > 0) {
        await tx.table("favorites").bulkAdd(
          favoriteIds.map((menuItemId) => ({
            menuItemId,
            scope: legacyScope.scope,
            profileId: legacyScope.profileId,
            spaceId: legacyScope.spaceId,
            updatedAt: now,
          }))
        );
      }
      if (wishIds.length > 0) {
        await tx.table("wishes").bulkAdd(
          wishIds.map((menuItemId) => ({
            menuItemId,
            scope: legacyScope.scope,
            profileId: legacyScope.profileId,
            spaceId: legacyScope.spaceId,
            updatedAt: now,
          }))
        );
      }
    });

    this.version(15).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt, [tableName+recordId]",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      wishes: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      favorites: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      personalWeights: "++id, menuItemId, scope, profileId, spaceId, updatedAt, [scope+menuItemId], [profileId+menuItemId]",
      likes: "id, menuItemId, profileId, spaceId, [menuItemId+profileId], [spaceId+syncStatus]",
      comments: "id, menuItemId, profileId, spaceId, createdAt, [spaceId+syncStatus]",
      syncConflicts: "id, spaceId, tableName, recordId, seq, [spaceId+tableName], [spaceId+recordId]",
      menuGroups: "id, scope, profileId, spaceId, updatedAt, sortOrder, [scope+sortOrder], [profileId+sortOrder]",
      menuGroupItems: "++id, groupId, menuItemId, profileId, spaceId, updatedAt, [groupId+menuItemId], [profileId+groupId], sortOrder",
    });
  }
}

export const db = new AppDatabase();

export async function resetDatabase() {
  await db.menuItems.clear();
  await db.tags.clear();
  await db.rollHistory.clear();
  await db.comboTemplates.clear();
  await db.settings.clear();
  await db.pendingDeletions.clear();
  await db.tagMappings.clear();
  await db.avoidances.clear();
  await db.wishes.clear();
  await db.favorites.clear();
  await db.personalWeights.clear();
  await db.likes.clear();
  await db.comments.clear();
  await db.syncConflicts.clear();
  await db.menuGroups.clear();
  await db.menuGroupItems.clear();
}

export async function resetLocalSessionData() {
  await db.transaction(
    "rw",
    [
      db.menuItems,
      db.tags,
      db.rollHistory,
      db.comboTemplates,
      db.pendingDeletions,
      db.tagMappings,
      db.avoidances,
      db.wishes,
      db.favorites,
      db.personalWeights,
      db.likes,
      db.comments,
      db.syncConflicts,
      db.menuGroups,
      db.menuGroupItems,
    ],
    async () => {
      await db.menuItems.clear();
      await db.tags.clear();
      await db.rollHistory.clear();
      await db.comboTemplates.clear();
      await db.pendingDeletions.clear();
      await db.tagMappings.clear();
      await db.avoidances.clear();
      await db.wishes.clear();
      await db.favorites.clear();
      await db.personalWeights.clear();
      await db.likes.clear();
      await db.comments.clear();
      await db.syncConflicts.clear();
      await db.menuGroups.clear();
      await db.menuGroupItems.clear();
    }
  );
}

function preferLike(candidate: Like, existing: Like): boolean {
  const candidateScore = getSyncPriority(candidate.syncStatus);
  const existingScore = getSyncPriority(existing.syncStatus);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }
  return candidate.createdAt < existing.createdAt;
}

function getSyncPriority(status: Like["syncStatus"]): number {
  if (status === "pending") return 3;
  if (status === "conflict") return 2;
  if (status === "synced") return 1;
  return 0;
}

function getLegacyPrivateScope(): {
  scope: "local" | "profile";
  profileId?: string;
  spaceId?: string;
} {
  if (typeof window === "undefined") {
    return { scope: "local" };
  }
  try {
    const profileRaw = localStorage.getItem("hyet_profile_v1");
    const spaceRaw = localStorage.getItem("hyet_space_v1");
    if (!profileRaw || !spaceRaw) {
      return { scope: "local" };
    }
    const profile = JSON.parse(profileRaw) as { id?: string };
    const space = JSON.parse(spaceRaw) as { id?: string };
    if (profile?.id && space?.id) {
      return {
        scope: "profile",
        profileId: profile.id,
        spaceId: space.id,
      };
    }
  } catch {
    return { scope: "local" };
  }
  return { scope: "local" };
}

function normalizeLegacyScope(
  currentScope: "local" | "space" | "profile" | undefined,
  fallbackScope: "local" | "profile"
): "local" | "profile" {
  if (currentScope === "profile") return "profile";
  if (currentScope === "space") return "profile";
  if (currentScope === "local") return "local";
  return fallbackScope;
}
