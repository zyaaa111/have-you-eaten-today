import Dexie, { Table } from "dexie";
import {
  MenuItem,
  Tag,
  RollHistory,
  ComboTemplate,
} from "./types";

const DB_NAME = "HaveYouEatenTodayDB";
const DB_VERSION = 5;

export interface PendingDeletion {
  id?: number;
  tableName: "menu_items" | "tags" | "combo_templates";
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

class AppDatabase extends Dexie {
  menuItems!: Table<MenuItem, string>;
  tags!: Table<Tag, string>;
  rollHistory!: Table<RollHistory, string>;
  comboTemplates!: Table<ComboTemplate, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  pendingDeletions!: Table<PendingDeletion, number>;
  tagMappings!: Table<TagMapping, number>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      menuItems: "id, kind, name, shop, *tags, weight, createdAt, updatedAt",
      tags: "id, name, type, createdAt",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt",
      settings: "key",
    });

    this.version(2).stores({
      menuItems: "id, kind, name, shop, *tags, weight, createdAt, updatedAt",
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
      menuItems: "id, kind, name, shop, *tags, weight, createdAt, updatedAt, [spaceId+syncStatus]",
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
      menuItems: "id, kind, name, shop, *tags, weight, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
    });

    this.version(5).stores({
      menuItems: "id, kind, name, shop, *tags, weight, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
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
}
