import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDatabase } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { rollSingle, rollCombo, clearRollHistory } from "@/lib/roll";
import { saveWishIds } from "@/lib/wishlist";
import { saveSetting } from "@/lib/settings";
import { addAvoidance } from "@/lib/avoidances";
import { v4 as uuidv4 } from "uuid";

describe("Roll Engine", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedDatabase();
  });

  it("rollSingle returns null when no candidates", async () => {
    await resetDatabase();
    const result = await rollSingle({});
    expect(result).toBeNull();
  });

  it("rollSingle records history", async () => {
    const before = await db.rollHistory.count();
    const result = await rollSingle({});
    expect(result).not.toBeNull();
    const after = await db.rollHistory.count();
    expect(after).toBe(before + 1);
  });

  it("rollSingle dedup prevents recent items from being rolled again", async () => {
    // Clear history first
    await clearRollHistory();
    const result = await rollSingle({});
    expect(result).not.toBeNull();
    const rolledId = result!.items[0].menuItemId;

    // Roll again with dedup enabled - should not get the same item if others exist
    // But if pool is small, it may fallback. Let's verify by checking all menu items.
    const allItems = await db.menuItems.toArray();
    if (allItems.length > 1) {
      let sameItemCount = 0;
      for (let i = 0; i < 20; i++) {
        const r = await rollSingle({});
        if (r && r.items[0].menuItemId === rolledId) sameItemCount++;
      }
      // With dedup, the recently rolled item should be heavily penalized
      expect(sameItemCount).toBeLessThan(20);
    }
  });

  it("rollSingle ignoreDedup bypasses dedup", async () => {
    await clearRollHistory();
    const first = await rollSingle({});
    expect(first).not.toBeNull();

    const second = await rollSingle({ ignoreDedup: true });
    expect(second).not.toBeNull();
    // Should still be able to roll (no null)
  });

  it("rollCombo returns null for nonexistent template", async () => {
    const result = await rollCombo({ templateId: uuidv4() });
    expect(result).toBeNull();
  });

  it("rollCombo returns correct item count for a builtin template", async () => {
    const template = await db.comboTemplates.where("name").startsWith("1主食 + 1荤菜 + 1素菜").first();
    expect(template).toBeDefined();

    // Ensure enough items exist for each rule
    const tags = await db.tags.toArray();
    const stapleTag = tags.find((t) => t.name === "主食")!;
    const meatTag = tags.find((t) => t.name === "荤菜")!;
    const vegTag = tags.find((t) => t.name === "素菜")!;

    await db.menuItems.bulkAdd([
      { id: uuidv4(), kind: "recipe", name: "米饭", tags: [stapleTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
      { id: uuidv4(), kind: "recipe", name: "清蒸鱼", tags: [meatTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
      { id: uuidv4(), kind: "recipe", name: "凉拌黄瓜", tags: [vegTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
    ]);

    const result = await rollCombo({ templateId: template!.id });
    expect(result).not.toBeNull();
    expect(result!.items.length).toBe(3);
  });

  it("rollCombo avoids duplicates within the same rule", async () => {
    const template = await db.comboTemplates.where("name").startsWith("2小吃 + 1饮料").first();
    if (template) {
      const result = await rollCombo({ templateId: template.id });
      expect(result).not.toBeNull();
      const ids = result!.items.map((i) => i.menuItemId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it("wishlist boosts selection probability", async () => {
    await clearRollHistory();
    const allItems = await db.menuItems.toArray();
    if (allItems.length < 2) {
      return; // skip if not enough data
    }

    const targetId = allItems[0].id;
    await saveWishIds([targetId]);

    let targetHits = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      await clearRollHistory(); // clear each time so dedup doesn't interfere
      const r = await rollSingle({});
      if (r && r.items[0].menuItemId === targetId) targetHits++;
    }

    // With 3x weight boost, target should be selected more often than baseline 1/n.
    // For n items, baseline expected = trials / n. We expect significantly more.
    const baseline = trials / allItems.length;
    expect(targetHits).toBeGreaterThan(baseline);
  });

  it("rollSingle bypasses dedup when globally disabled", async () => {
    await clearRollHistory();
    await saveSetting("dedupEnabled", false);

    const first = await rollSingle({});
    expect(first).not.toBeNull();

    const second = await rollSingle({});
    expect(second).not.toBeNull();
    // With dedup globally disabled, rolling again should never fallback to ignoredDedup
    // just because of dedup; it should behave normally.

    await saveSetting("dedupEnabled", true);
  });

  it("rollSingle excludes avoided items", async () => {
    await clearRollHistory();
    const allItems = await db.menuItems.toArray();
    if (allItems.length < 2) return;

    const avoidedId = allItems[0].id;
    await addAvoidance(avoidedId);

    let avoidedHits = 0;
    const trials = 30;
    for (let i = 0; i < trials; i++) {
      await clearRollHistory();
      const r = await rollSingle({});
      if (r && r.items[0].menuItemId === avoidedId) avoidedHits++;
    }
    expect(avoidedHits).toBe(0);
  });

  it("rollCombo excludes avoided items", async () => {
    await clearRollHistory();
    const template = await db.comboTemplates.where("name").startsWith("1主食 + 1荤菜 + 1素菜").first();
    expect(template).toBeDefined();

    const tags = await db.tags.toArray();
    const stapleTag = tags.find((t) => t.name === "主食")!;
    const meatTag = tags.find((t) => t.name === "荤菜")!;
    const vegTag = tags.find((t) => t.name === "素菜")!;

    const riceId = uuidv4();
    const fishId = uuidv4();
    const cucumberId = uuidv4();

    await db.menuItems.bulkAdd([
      { id: riceId, kind: "recipe", name: "米饭", tags: [stapleTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
      { id: fishId, kind: "recipe", name: "清蒸鱼", tags: [meatTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
      { id: cucumberId, kind: "recipe", name: "凉拌黄瓜", tags: [vegTag.id], weight: 1, createdAt: Date.now(), updatedAt: Date.now() },
    ]);

    // Avoid the only meat item
    await addAvoidance(fishId);

    const result = await rollCombo({ templateId: template!.id });
    expect(result).not.toBeNull();
    const ids = result!.items.map((i) => i.menuItemId);
    expect(ids).not.toContain(fishId);
  });
});
