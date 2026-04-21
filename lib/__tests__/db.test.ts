import Dexie from "dexie";
import { describe, it, expect, beforeEach } from "vitest";
import { AppDatabase, db, resetDatabase, resetLocalSessionData } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { MenuItem } from "@/lib/types";
import { clearLocalIdentity, saveLocalIdentity } from "@/lib/identity";
import { v4 as uuidv4 } from "uuid";

describe("Database", () => {
  beforeEach(async () => {
    clearLocalIdentity();
    await resetDatabase();
  });

  it("should have empty tables after reset", async () => {
    expect(await db.menuItems.count()).toBe(0);
    expect(await db.tags.count()).toBe(0);
    expect(await db.rollHistory.count()).toBe(0);
    expect(await db.comboTemplates.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(await db.personalWeights.count()).toBe(0);
  });

  it("should seed default tags, menu items and templates", async () => {
    await seedDatabase();
    const tags = await db.tags.toArray();
    const menuItems = await db.menuItems.toArray();
    const templates = await db.comboTemplates.toArray();

    expect(tags.length).toBeGreaterThan(0);
    expect(menuItems.length).toBeGreaterThan(0);
    expect(templates.length).toBeGreaterThan(0);

    expect(menuItems.some((m) => m.name === "番茄炒蛋")).toBe(true);
    expect(templates.some((t) => t.isBuiltin)).toBe(true);
  });

  it("should not seed example data when a shared-space identity exists", async () => {
    saveLocalIdentity({
      profile: { id: "profile-1", spaceId: "space-1", nickname: "测试用户", joinedAt: Date.now() },
      space: { id: "space-1", inviteCode: "ABC123", name: "共享空间", createdAt: Date.now(), updatedAt: Date.now() },
    });

    await seedDatabase();

    expect(await db.tags.count()).toBe(0);
    expect(await db.menuItems.count()).toBe(0);
    expect(await db.comboTemplates.count()).toBe(0);
  });

  it("should reset local session data while preserving settings", async () => {
    await db.settings.put({ key: "theme", value: "dark" });
    await db.menuItems.add({
      id: "menu-1",
      kind: "recipe",
      name: "测试菜",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.tags.add({
      id: "tag-1",
      name: "测试标签",
      type: "custom",
      createdAt: Date.now(),
    });
    await db.rollHistory.add({
      id: "history-1",
      rolledAt: Date.now(),
      items: [{ menuItemId: "menu-1", name: "测试菜", kind: "recipe" }],
      ruleSnapshot: "single",
    });
    await db.comboTemplates.add({
      id: "template-1",
      name: "模板",
      rules: [],
      isBuiltin: false,
      createdAt: Date.now(),
    });
    await db.pendingDeletions.add({
      tableName: "menu_items",
      recordId: "menu-2",
      spaceId: "space-1",
      createdAt: Date.now(),
    });
    await db.tagMappings.add({ spaceId: "space-1", aliasId: "tag-a", canonicalId: "tag-1" });
    await db.avoidances.add({ menuItemId: "menu-1" });
    await db.personalWeights.add({ menuItemId: "menu-1", weight: 3 });
    await db.likes.add({
      id: "like-1",
      menuItemId: "menu-1",
      profileId: "profile-1",
      spaceId: "space-1",
      createdAt: Date.now(),
    });
    await db.comments.add({
      id: "comment-1",
      menuItemId: "menu-1",
      profileId: "profile-1",
      spaceId: "space-1",
      nickname: "测试用户",
      content: "好吃",
      isAnonymous: false,
      createdAt: Date.now(),
    });

    await resetLocalSessionData();

    expect(await db.settings.get("theme")).toMatchObject({ value: "dark" });
    expect(await db.menuItems.count()).toBe(0);
    expect(await db.tags.count()).toBe(0);
    expect(await db.rollHistory.count()).toBe(0);
    expect(await db.comboTemplates.count()).toBe(0);
    expect(await db.pendingDeletions.count()).toBe(0);
    expect(await db.tagMappings.count()).toBe(0);
    expect(await db.avoidances.count()).toBe(0);
    expect(await db.personalWeights.count()).toBe(0);
    expect(await db.likes.count()).toBe(0);
    expect(await db.comments.count()).toBe(0);
  });

  it("should use deterministic ids for seed data", async () => {
    await seedDatabase();
    const tag = await db.tags.where("name").equals("川菜").first();
    expect(tag?.id).toBe("seed-tag-川菜");
    const item = await db.menuItems.where("name").equals("番茄炒蛋").first();
    expect(item?.id).toBe("seed-item-recipe-番茄炒蛋");
    const template = await db.comboTemplates.where("name").equals("1主食 + 1荤菜 + 1素菜").first();
    expect(template?.id).toBe("seed-template-1主食 + 1荤菜 + 1素菜");
  });

  it("should support menu item CRUD", async () => {
    const item: MenuItem = {
      id: uuidv4(),
      kind: "recipe",
      name: "测试菜",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.menuItems.add(item);
    let found = await db.menuItems.get(item.id);
    expect(found).not.toBeUndefined();
    expect(found?.name).toBe("测试菜");

    await db.menuItems.update(item.id, { name: "改名后" });
    found = await db.menuItems.get(item.id);
    expect(found?.name).toBe("改名后");

    await db.menuItems.delete(item.id);
    found = await db.menuItems.get(item.id);
    expect(found).toBeUndefined();
  });

  it("should cascade remove tag references from menu items", async () => {
    await seedDatabase();
    const tag = await db.tags.where("name").equals("素菜").first();
    expect(tag).toBeDefined();

    const itemsWithTag = await db.menuItems.where("tags").anyOf(tag!.id).toArray();
    expect(itemsWithTag.length).toBeGreaterThan(0);

    // Simulate the cascade logic from tags page
    await db.transaction("rw", db.menuItems, async () => {
      for (const item of itemsWithTag) {
        await db.menuItems.update(item.id, {
          tags: item.tags.filter((tid) => tid !== tag!.id),
          updatedAt: Date.now(),
        });
      }
    });

    const after = await db.menuItems.where("tags").anyOf(tag!.id).count();
    expect(after).toBe(0);
  });

  it("should remove legacy menuItems.weight during Dexie migration without touching personalWeights", async () => {
    const legacyDbName = `HaveYouEatenTodayDB_migration_${Date.now()}`;
    const legacyDb = new Dexie(legacyDbName);

    legacyDb.version(8).stores({
      menuItems: "id, kind, name, shop, *tags, createdAt, updatedAt, [spaceId+syncStatus]",
      tags: "id, name, type, createdAt, [spaceId+syncStatus]",
      rollHistory: "id, rolledAt",
      comboTemplates: "id, name, isBuiltin, createdAt, [spaceId+syncStatus]",
      settings: "key",
      pendingDeletions: "++id, tableName, recordId, spaceId, createdAt",
      tagMappings: "++id, aliasId, canonicalId, spaceId",
      avoidances: "++id, menuItemId",
      personalWeights: "++id, menuItemId",
    });

    await legacyDb.open();
    await legacyDb.table("menuItems").add({
      id: "legacy_weight_item",
      kind: "recipe",
      name: "旧权重菜",
      tags: [],
      weight: 8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await legacyDb.table("personalWeights").add({
      menuItemId: "legacy_weight_item",
      weight: 5,
    });
    await legacyDb.close();

    const migratedDb = new AppDatabase(legacyDbName);

    try {
      await migratedDb.open();
      const item = await migratedDb.menuItems.get("legacy_weight_item") as MenuItem & { weight?: number };
      expect(item?.weight).toBeUndefined();
      expect(await migratedDb.personalWeights.toArray()).toMatchObject([
        { menuItemId: "legacy_weight_item", weight: 5 },
      ]);
    } finally {
      migratedDb.close();
      await migratedDb.delete();
    }
  });
});
