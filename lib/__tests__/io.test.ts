import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDatabase } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { exportData, exportWithChecksum, importData } from "@/lib/io";
import { clearLocalIdentity, saveLocalIdentity } from "@/lib/identity";
import { getWeight } from "@/lib/weights";

describe("Import/Export", () => {
  beforeEach(async () => {
    clearLocalIdentity();
    await resetDatabase();
  });

  it("should export data with correct structure", async () => {
    await seedDatabase();
    const data = await exportData();
    expect(data.schemaVersion).toBeDefined();
    expect(data.appVersion).toBeDefined();
    expect(data.exportedAt).toBeTypeOf("number");
    expect(Array.isArray(data.data.settings)).toBe(true);
    expect(Array.isArray(data.data.avoidances)).toBe(true);
    expect(Array.isArray(data.data.tags)).toBe(true);
    expect(Array.isArray(data.data.menuItems)).toBe(true);
    expect(Array.isArray(data.data.comboTemplates)).toBe(true);
    expect(Array.isArray(data.data.rollHistory)).toBe(true);
    expect(Array.isArray(data.data.personalWeights)).toBe(true);
  });

  it("should export only local private data and keep related settings", async () => {
    await db.settings.put({ key: "theme", value: "scrapbook" });
    await db.tags.bulkAdd([
      { id: "local-tag", name: "本地标签", type: "custom", createdAt: Date.now() },
      {
        id: "shared-tag",
        name: "共享标签",
        type: "custom",
        createdAt: Date.now(),
        spaceId: "space-1",
        profileId: "profile-1",
        syncStatus: "synced",
        version: 2,
      },
    ]);
    await db.menuItems.bulkAdd([
      {
        id: "local-item",
        kind: "recipe",
        name: "本地菜",
        tags: ["local-tag", "shared-tag"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "shared-item",
        kind: "recipe",
        name: "共享菜",
        tags: ["shared-tag"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        spaceId: "space-1",
        profileId: "profile-1",
        syncStatus: "synced",
        version: 3,
      },
    ]);
    await db.comboTemplates.bulkAdd([
      {
        id: "local-template",
        name: "本地模板",
        rules: [{ count: 1, tagIds: ["local-tag", "shared-tag"] }],
        isBuiltin: false,
        createdAt: Date.now(),
      },
      {
        id: "shared-template",
        name: "共享模板",
        rules: [{ count: 1, tagIds: ["shared-tag"] }],
        isBuiltin: false,
        createdAt: Date.now(),
        spaceId: "space-1",
        profileId: "profile-1",
        syncStatus: "synced",
        version: 2,
      },
    ]);
    await db.personalWeights.bulkAdd([
      { menuItemId: "local-item", weight: 5 },
      { menuItemId: "shared-item", weight: 7 },
    ]);
    await db.avoidances.bulkAdd([{ menuItemId: "local-item" }, { menuItemId: "shared-item" }]);
    await db.rollHistory.add({
      id: "history-1",
      rolledAt: Date.now(),
      items: [{ menuItemId: "shared-item", name: "共享菜", kind: "recipe" }],
      ruleSnapshot: "history snapshot",
    });

    const exported = await exportData();

    expect(exported.data.settings).toMatchObject([{ key: "theme", value: "scrapbook" }]);
    expect(exported.data.tags.map((tag) => tag.id)).toEqual(["local-tag"]);
    expect(exported.data.menuItems.map((item) => item.id)).toEqual(["local-item"]);
    expect(exported.data.menuItems[0]?.tags).toEqual(["local-tag"]);
    expect(exported.data.comboTemplates.map((template) => template.id)).toEqual(["local-template"]);
    expect(exported.data.comboTemplates[0]?.rules[0]?.tagIds).toEqual(["local-tag"]);
    expect(exported.data.personalWeights).toMatchObject([{ menuItemId: "local-item", weight: 5 }]);
    expect(exported.data.avoidances).toMatchObject([{ menuItemId: "local-item" }]);
    expect(exported.data.rollHistory).toHaveLength(1);
    expect(exported.data.rollHistory[0]?.items[0]?.menuItemId).toBe("shared-item");
  });

  it("should fail import for invalid JSON", async () => {
    const blob = new Blob(["not json"], { type: "application/json" });
    const file = new File([blob], "bad.json");
    const result = await importData(file);
    expect(result.success).toBe(false);
  });

  it("should fail import for missing fields", async () => {
    const blob = new Blob([JSON.stringify({ schemaVersion: "1.0.0" })], { type: "application/json" });
    const file = new File([blob], "bad.json");
    const result = await importData(file);
    expect(result.success).toBe(false);
  });

  it("should round-trip export and import", async () => {
    await seedDatabase();
    await db.settings.put({ key: "theme", value: "dark" });
    await db.avoidances.add({ menuItemId: "seed-item-recipe-番茄炒蛋" });
    await db.personalWeights.add({ menuItemId: "seed-item-recipe-番茄炒蛋", weight: 4 });
    const before = await exportData();

    await resetDatabase();
    expect(await db.menuItems.count()).toBe(0);

    const json = JSON.stringify(before);
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], "backup.json");
    const result = await importData(file);
    expect(result.success).toBe(true);

    const afterTags = await db.tags.toArray();
    const afterMenuItems = await db.menuItems.toArray();
    const afterTemplates = await db.comboTemplates.toArray();

    expect(afterTags.length).toBe(before.data.tags.length);
    expect(afterMenuItems.length).toBe(before.data.menuItems.length);
    expect(afterTemplates.length).toBe(before.data.comboTemplates.length);
    expect(await db.settings.get("theme")).toMatchObject({ value: "dark" });
    expect(await db.avoidances.toArray()).toMatchObject([{ menuItemId: "seed-item-recipe-番茄炒蛋" }]);

    const afterWeights = await db.personalWeights.toArray();
    expect(afterWeights.length).toBe(before.data.personalWeights?.length ?? 0);
  });

  it("should localize imported records and restore settings, avoidances and weights", async () => {
    const backup = {
      schemaVersion: "1.1.0",
      exportedAt: Date.now(),
      appVersion: "1.1.0",
      data: {
        settings: [
          { key: "theme", value: "dark" },
          { key: "defaultDedupDays", value: 5 },
        ],
        avoidances: [{ menuItemId: "shared-item" }, { menuItemId: "missing-item" }],
        tags: [
          {
            id: "shared-tag",
            name: "共享标签",
            type: "custom" as const,
            createdAt: Date.now(),
            spaceId: "space-1",
            profileId: "profile-1",
            syncStatus: "synced" as const,
            version: 8,
          },
        ],
        menuItems: [
          {
            id: "shared-item",
            kind: "recipe" as const,
            name: "共享菜",
            tags: ["shared-tag"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            spaceId: "space-1",
            profileId: "profile-1",
            syncStatus: "pending" as const,
            version: 9,
          },
        ],
        comboTemplates: [
          {
            id: "shared-template",
            name: "共享模板",
            rules: [{ count: 1, tagIds: ["shared-tag"] }],
            isBuiltin: false,
            createdAt: Date.now(),
            spaceId: "space-1",
            profileId: "profile-1",
            syncStatus: "synced" as const,
            version: 6,
          },
        ],
        rollHistory: [
          {
            id: "history-1",
            rolledAt: Date.now(),
            items: [{ menuItemId: "shared-item", name: "共享菜", kind: "recipe" as const }],
            ruleSnapshot: "shared snapshot",
          },
        ],
        personalWeights: [
          { menuItemId: "shared-item", weight: 6 },
          { menuItemId: "missing-item", weight: 3 },
        ],
      },
    };

    const file = new File([JSON.stringify(backup)], "localized-backup.json");
    const result = await importData(file);

    expect(result.success).toBe(true);
    expect(await db.settings.get("theme")).toMatchObject({ value: "dark" });
    expect(await db.settings.get("defaultDedupDays")).toMatchObject({ value: 5 });
    expect(await db.avoidances.toArray()).toMatchObject([{ menuItemId: "shared-item" }]);
    expect(await db.personalWeights.toArray()).toMatchObject([{ menuItemId: "shared-item", weight: 6 }]);
    expect(await db.rollHistory.count()).toBe(1);
    expect(await db.menuItems.get("shared-item")).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
      tags: ["shared-tag"],
    });
    expect(await db.tags.get("shared-tag")).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
    });
    expect(await db.comboTemplates.get("shared-template")).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
    });
  });

  it("should preserve imageUrl during default export and import", async () => {
    const imageUrl = "data:image/jpeg;base64,/9j/fake";
    await db.menuItems.add({
      id: "image-roundtrip-item",
      kind: "recipe",
      name: "带图片的菜",
      tags: [],
      imageUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const exported = await exportData();
    const exportedItem = exported.data.menuItems.find((item) => item.id === "image-roundtrip-item");
    expect(exportedItem?.imageUrl).toBe(imageUrl);

    const file = new File([JSON.stringify(exported)], "image-backup.json");
    const result = await importData(file);
    expect(result.success).toBe(true);

    const importedItem = await db.menuItems.get("image-roundtrip-item");
    expect(importedItem?.imageUrl).toBe(imageUrl);
  });

  it("should synthesize personal weights from legacy menu item weights on import", async () => {
    const legacyBackup = {
      schemaVersion: "1.0.0",
      exportedAt: Date.now(),
      appVersion: "1.0.4",
      data: {
        tags: [],
        menuItems: [
          {
            id: "legacy-item",
            kind: "recipe" as const,
            name: "旧备份菜",
            tags: [],
            weight: 5,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        comboTemplates: [],
        rollHistory: [],
      },
    };

    const file = new File([JSON.stringify(legacyBackup)], "legacy-backup.json");
    const result = await importData(file);

    expect(result.success).toBe(true);
    expect(await getWeight("legacy-item")).toBe(5);
    expect(await db.personalWeights.count()).toBe(1);
    expect(await db.personalWeights.toArray()).toMatchObject([{ menuItemId: "legacy-item", weight: 5 }]);
    expect(await db.menuItems.get("legacy-item")).not.toHaveProperty("weight");
  });

  it("should prefer explicit personal weights over legacy menu item weights on import", async () => {
    const backup = {
      schemaVersion: "1.0.0",
      exportedAt: Date.now(),
      appVersion: "1.0.4",
      data: {
        tags: [],
        menuItems: [
          {
            id: "weighted-item",
            kind: "recipe" as const,
            name: "已迁移菜品",
            tags: [],
            weight: 3,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        comboTemplates: [],
        rollHistory: [],
        personalWeights: [{ menuItemId: "weighted-item", weight: 9 }],
      },
    };

    const file = new File([JSON.stringify(backup)], "backup.json");
    const result = await importData(file);

    expect(result.success).toBe(true);
    expect(await getWeight("weighted-item")).toBe(9);
    expect(await db.personalWeights.count()).toBe(1);
    expect(await db.personalWeights.toArray()).toMatchObject([{ menuItemId: "weighted-item", weight: 9 }]);
  });

  it("should block import while still in a shared space", async () => {
    saveLocalIdentity({
      profile: { id: "profile-1", spaceId: "space-1", nickname: "测试用户", joinedAt: Date.now() },
      space: { id: "space-1", inviteCode: "ABC123", name: "共享空间", createdAt: Date.now(), updatedAt: Date.now() },
    });
    const backup = {
      schemaVersion: "1.1.0",
      exportedAt: Date.now(),
      appVersion: "1.1.0",
      data: {
        settings: [],
        avoidances: [],
        tags: [],
        menuItems: [],
        comboTemplates: [],
        rollHistory: [],
        personalWeights: [],
      },
    };

    const file = new File([JSON.stringify(backup)], "shared-mode.json");
    const result = await importData(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain("共享空间");
    expect(await db.menuItems.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });
});

describe("Export: checksum", () => {
  beforeEach(async () => {
    clearLocalIdentity();
    await resetDatabase();
  });

  it("should include checksum field when exporting with checksum", async () => {
    await seedDatabase();
    const data = await exportWithChecksum();
    expect(data.checksum).toBeDefined();
    expect(typeof data.checksum).toBe("string");
    expect(data.checksum.length).toBe(64); // SHA-256 hex
  });

  it("should fail import when checksum does not match", async () => {
    await seedDatabase();
    const data = await exportWithChecksum();
    // Tamper with data
    data.data.menuItems = [];
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], "tampered.json");
    const result = await importData(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain("校验失败");
  });

  it("should import successfully when checksum matches", async () => {
    await seedDatabase();
    const data = await exportWithChecksum();
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], "checksum-valid.json");
    const result = await importData(file);
    expect(result.success).toBe(true);
  });

  it("should import legacy format without checksum", async () => {
    const legacyBackup = {
      schemaVersion: "1.0.0",
      exportedAt: Date.now(),
      appVersion: "1.0.0",
      data: {
        tags: [],
        menuItems: [],
        comboTemplates: [],
        rollHistory: [],
      },
    };
    const json = JSON.stringify(legacyBackup);
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], "legacy.json");
    const result = await importData(file);
    expect(result.success).toBe(true);
  });
});
