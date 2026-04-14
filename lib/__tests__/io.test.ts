import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDatabase } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { exportData, importData } from "@/lib/io";
import { getWeight } from "@/lib/weights";

describe("Import/Export", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("should export data with correct structure", async () => {
    await seedDatabase();
    const data = await exportData();
    expect(data.schemaVersion).toBeDefined();
    expect(data.appVersion).toBeDefined();
    expect(data.exportedAt).toBeTypeOf("number");
    expect(Array.isArray(data.data.tags)).toBe(true);
    expect(Array.isArray(data.data.menuItems)).toBe(true);
    expect(Array.isArray(data.data.comboTemplates)).toBe(true);
    expect(Array.isArray(data.data.rollHistory)).toBe(true);
    expect(Array.isArray(data.data.personalWeights)).toBe(true);
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

    const afterWeights = await db.personalWeights.toArray();
    expect(afterWeights.length).toBe(before.data.personalWeights?.length ?? 0);
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
});
