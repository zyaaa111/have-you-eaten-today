import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDatabase } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { MenuItem } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

describe("Database", () => {
  beforeEach(async () => {
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
});
