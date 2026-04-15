import Dexie, { Table } from "dexie";
import {
  MenuItem,
  Tag,
  RollHistory,
  ComboTemplate,
  PersonalWeight,
  Like,
  Comment,
} from "./types";
import { buildLikeId } from "./like-id";

export const DB_NAME = "HaveYouEatenTodayDB";
export const DB_VERSION = 11;

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
  settings!: Table<{ key: string; value: unknown }, string>;
  pendingDeletions!: Table<PendingDeletion, number>;
  tagMappings!: Table<TagMapping, number>;
  avoidances!: Table<{ id?: number; menuItemId: string }, number>;
  personalWeights!: Table<PersonalWeight, number>;
  likes!: Table<Like, string>;
  comments!: Table<Comment, string>;

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
        if (!item.remoteId) item.remoteId = undefined;
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
        if (!item.remoteId) item.remoteId = undefined;
        if (typeof item.version !== "number") item.version = 1;
      });
      const patchTags = tx.table("tags").toCollection().modify((item: Partial<Tag>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.profileId) item.profileId = undefined;
        if (!item.remoteId) item.remoteId = undefined;
        if (typeof item.version !== "number") item.version = 1;
      });
      const patchTemplates = tx.table("comboTemplates").toCollection().modify((item: Partial<ComboTemplate>) => {
        if (!item.syncStatus) item.syncStatus = "local";
        if (!item.spaceId) item.spaceId = undefined;
        if (!item.profileId) item.profileId = undefined;
        if (!item.remoteId) item.remoteId = undefined;
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
  await db.personalWeights.clear();
  await db.likes.clear();
  await db.comments.clear();
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
