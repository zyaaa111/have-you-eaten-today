import { db } from "./db";

export async function getWeight(menuItemId: string): Promise<number> {
  const personal = await db.personalWeights.where({ menuItemId }).first();
  if (personal) return personal.weight;

  const item = await db.menuItems.get(menuItemId);
  if (item && typeof item.weight === "number") return item.weight;

  return 1;
}

export async function setWeight(menuItemId: string, weight: number): Promise<void> {
  const existing = await db.personalWeights.where({ menuItemId }).first();
  if (existing?.id !== undefined) {
    await db.personalWeights.update(existing.id, { weight });
  } else {
    await db.personalWeights.add({ menuItemId, weight });
  }
}

export async function getWeightsMap(menuItemIds: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};

  const personalWeights = await db.personalWeights.where("menuItemId").anyOf(menuItemIds).toArray();
  for (const pw of personalWeights) {
    map[pw.menuItemId] = pw.weight;
  }

  const missingIds = menuItemIds.filter((id) => map[id] === undefined);
  if (missingIds.length > 0) {
    const items = await db.menuItems.where("id").anyOf(missingIds).toArray();
    for (const item of items) {
      map[item.id] = typeof item.weight === "number" ? item.weight : 1;
    }
  }

  for (const id of menuItemIds) {
    if (map[id] === undefined) {
      map[id] = 1;
    }
  }

  return map;
}

export async function deleteWeight(menuItemId: string): Promise<void> {
  await db.personalWeights.where({ menuItemId }).delete();
}
