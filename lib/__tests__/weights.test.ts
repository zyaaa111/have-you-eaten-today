import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDatabase } from "@/lib/db";
import { getWeight, setWeight, getWeightsMap, deleteWeight } from "@/lib/weights";
import { v4 as uuidv4 } from "uuid";

describe("Weights", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("getWeight falls back to menuItems.weight and then 1", async () => {
    const id = uuidv4();

    // No item, no personal weight -> 1
    expect(await getWeight(id)).toBe(1);

    // Item with weight 5, no personal weight -> 5
    await db.menuItems.add({
      id,
      kind: "recipe",
      name: "测试菜",
      tags: [],
      weight: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(await getWeight(id)).toBe(5);

    // Personal weight overrides item weight
    await setWeight(id, 8);
    expect(await getWeight(id)).toBe(8);
  });

  it("setWeight updates existing record", async () => {
    const id = uuidv4();
    await setWeight(id, 3);
    expect(await getWeight(id)).toBe(3);

    await setWeight(id, 7);
    expect(await getWeight(id)).toBe(7);

    const all = await db.personalWeights.toArray();
    expect(all.length).toBe(1);
  });

  it("getWeightsMap returns weights for multiple items", async () => {
    const id1 = uuidv4();
    const id2 = uuidv4();
    const id3 = uuidv4();

    await db.menuItems.bulkAdd([
      { id: id1, kind: "recipe", name: "菜1", tags: [], weight: 2, createdAt: Date.now(), updatedAt: Date.now() },
      { id: id2, kind: "recipe", name: "菜2", tags: [], weight: 3, createdAt: Date.now(), updatedAt: Date.now() },
    ]);
    await setWeight(id2, 10);

    const map = await getWeightsMap([id1, id2, id3]);
    expect(map[id1]).toBe(2);
    expect(map[id2]).toBe(10);
    expect(map[id3]).toBe(1);
  });

  it("deleteWeight removes personal weight", async () => {
    const id = uuidv4();
    await db.menuItems.add({
      id,
      kind: "recipe",
      name: "测试菜",
      tags: [],
      weight: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await setWeight(id, 9);
    expect(await getWeight(id)).toBe(9);

    await deleteWeight(id);
    expect(await getWeight(id)).toBe(4);
  });
});
