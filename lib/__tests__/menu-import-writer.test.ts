import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../db";
import type { ImportPreview } from "../menu-import-parser";
import { executeImport } from "../menu-import-writer";

describe("executeImport", () => {
  beforeEach(async () => {
    await db.menuItems.clear();
    await db.tags.clear();
    await db.personalWeights.clear();
  });

  it("imports recipe items with tags", async () => {
    const preview: ImportPreview = {
      toImport: [
        {
          rowIndex: 2,
          kind: "recipe",
          name: "番茄炒蛋",
          tagNamesByType: {
            cuisine: ["中餐"],
            category: ["快手菜"],
            custom: [],
          },
          weight: 1,
          ingredients: [
            { name: "番茄", amount: "2个", quantity: 2, unit: "个" },
            { name: "鸡蛋", amount: "3个", quantity: 3, unit: "个" },
          ],
          steps: [
            { order: 1, description: "番茄切块" },
            { order: 2, description: "炒鸡蛋" },
          ],
          tips: "酸甜口味",
          shop: "",
          shopAddress: "",
        },
      ],
      skipped: [],
      errors: [],
      newTags: [
        { name: "中餐", type: "cuisine" },
        { name: "快手菜", type: "category" },
      ],
    };

    const result = await executeImport(preview);
    expect(result.importedCount).toBe(1);
    expect(result.tagCreatedCount).toBe(2);
    expect(result.errorCount).toBe(0);

    // Verify tags were created
    const tags = await db.tags.toArray();
    expect(tags).toHaveLength(2);
    const tagNames = tags.map((t) => t.name);
    expect(tagNames).toContain("中餐");
    expect(tagNames).toContain("快手菜");

    // Verify menu items
    const items = await db.menuItems.toArray();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("番茄炒蛋");
    expect(items[0].kind).toBe("recipe");
    expect(items[0].tags).toHaveLength(2);
    expect(items[0].ingredients).toHaveLength(2);
    expect(items[0].steps).toHaveLength(2);
    expect(items[0].tips).toBe("酸甜口味");
  });

  it("imports takeout items with shop fields", async () => {
    const preview: ImportPreview = {
      toImport: [
        {
          rowIndex: 2,
          kind: "takeout",
          name: "黄焖鸡",
          tagNamesByType: { cuisine: [], category: [], custom: [] },
          weight: 1,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "老字号",
          shopAddress: "xx路",
        },
      ],
      skipped: [],
      errors: [],
      newTags: [],
    };

    await executeImport(preview);
    const items = await db.menuItems.toArray();
    expect(items).toHaveLength(1);
    expect(items[0].shop).toBe("老字号");
    expect(items[0].shopAddress).toBe("xx路");
    expect(items[0].ingredients).toBeUndefined();
  });

  it("resolves tag IDs to menu item tags array", async () => {
    const preview: ImportPreview = {
      toImport: [
        {
          rowIndex: 2,
          kind: "recipe",
          name: "A",
          tagNamesByType: {
            cuisine: ["川菜"],
            category: ["豆腐"],
            custom: ["辣"],
          },
          weight: 1,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "",
          shopAddress: "",
        },
      ],
      skipped: [],
      errors: [],
      newTags: [
        { name: "川菜", type: "cuisine" },
        { name: "豆腐", type: "category" },
        { name: "辣", type: "custom" },
      ],
    };

    await executeImport(preview);
    const items = await db.menuItems.toArray();
    expect(items[0].tags).toHaveLength(3);

    // Verify tag IDs are valid UUIDs
    for (const tagId of items[0].tags) {
      expect(tagId).toMatch(/^[0-9a-f]{8}-/);
    }
  });

  it("writes personal weight records for items with non-default weight", async () => {
    const preview: ImportPreview = {
      toImport: [
        {
          rowIndex: 2,
          kind: "recipe",
          name: "A",
          tagNamesByType: { cuisine: [], category: [], custom: [] },
          weight: 5,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "",
          shopAddress: "",
        },
        {
          rowIndex: 3,
          kind: "recipe",
          name: "B",
          tagNamesByType: { cuisine: [], category: [], custom: [] },
          weight: 1,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "",
          shopAddress: "",
        },
      ],
      skipped: [],
      errors: [],
      newTags: [],
    };

    await executeImport(preview);

    // Check weight was written
    const weights = await db.personalWeights.toArray();
    expect(weights).toHaveLength(1);
    expect(weights[0].weight).toBe(5);

    const items = await db.menuItems.toArray();
    const weightedItem = items.find((i) => i.name === "A");
    expect(weightedItem).toBeDefined();
    expect(weights[0].menuItemId).toBe(weightedItem!.id);
  });

  it("rolls back menu items and tags when weight write fails", async () => {
    const preview: ImportPreview = {
      toImport: [
        {
          rowIndex: 2,
          kind: "recipe",
          name: "A",
          tagNamesByType: { cuisine: ["川菜"], category: [], custom: [] },
          weight: 5,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "",
          shopAddress: "",
        },
      ],
      skipped: [],
      errors: [],
      newTags: [{ name: "川菜", type: "cuisine" }],
    };

    const bulkAddSpy = vi.spyOn(db.personalWeights, "bulkAdd").mockImplementationOnce(
      (() => Promise.reject(new Error("weight write failed"))) as unknown as typeof db.personalWeights.bulkAdd
    );

    try {
      await expect(executeImport(preview)).rejects.toThrow("weight write failed");
    } finally {
      bulkAddSpy.mockRestore();
    }

    expect(await db.menuItems.count()).toBe(0);
    expect(await db.tags.count()).toBe(0);
    expect(await db.personalWeights.count()).toBe(0);
  });

  it("returns zero counts for empty import", async () => {
    const result = await executeImport({
      toImport: [],
      skipped: [],
      errors: [],
      newTags: [],
    });
    expect(result.importedCount).toBe(0);
    expect(result.tagCreatedCount).toBe(0);
  });

  it("returns error and skipped counts from preview", async () => {
    const result = await executeImport({
      toImport: [
        {
          rowIndex: 2,
          kind: "recipe",
          name: "A",
          tagNamesByType: { cuisine: [], category: [], custom: [] },
          weight: 1,
          ingredients: [],
          steps: [],
          tips: "",
          shop: "",
          shopAddress: "",
        },
      ],
      skipped: [
        {
          row: {
            rowIndex: 3,
            kind: "recipe",
            name: "B",
            tagNamesByType: { cuisine: [], category: [], custom: [] },
            weight: 1,
            ingredients: [],
            steps: [],
            tips: "",
            shop: "",
            shopAddress: "",
          },
          reason: "duplicate",
        },
      ],
      errors: [{ rowIndex: 4, rawLine: "", message: "bad" }],
      newTags: [],
    });
    expect(result.skippedCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.importedCount).toBe(1);
  });
});
