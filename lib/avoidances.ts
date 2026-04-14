import { db } from "./db";

export async function getAvoidedIds(): Promise<Set<string>> {
  const rows = await db.avoidances.toArray();
  return new Set(rows.map((r) => r.menuItemId));
}

export async function isAvoided(menuItemId: string): Promise<boolean> {
  const count = await db.avoidances.where({ menuItemId }).count();
  return count > 0;
}

export async function addAvoidance(menuItemId: string): Promise<void> {
  const exists = await isAvoided(menuItemId);
  if (!exists) {
    await db.avoidances.add({ menuItemId });
  }
}

export async function removeAvoidance(menuItemId: string): Promise<void> {
  await db.avoidances.where({ menuItemId }).delete();
}

export async function toggleAvoidance(menuItemId: string): Promise<boolean> {
  const avoided = await isAvoided(menuItemId);
  if (avoided) {
    await removeAvoidance(menuItemId);
    return false;
  }
  await addAvoidance(menuItemId);
  return true;
}
