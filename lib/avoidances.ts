import { db } from "./db";
import { getCurrentPrivateScope, isRecordInScope, toScopedRecord } from "./private-scope";
import { scheduleProfileStateSync } from "./profile-state";

export async function getAvoidedIds(): Promise<Set<string>> {
  const scope = getCurrentPrivateScope();
  const rows = await db.avoidances.toArray();
  return new Set(rows.filter((record) => isRecordInScope(record, scope)).map((r) => r.menuItemId));
}

export async function isAvoided(menuItemId: string): Promise<boolean> {
  const scope = getCurrentPrivateScope();
  const row = await db.avoidances
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .first();
  return !!row;
}

export async function addAvoidance(menuItemId: string): Promise<void> {
  const exists = await isAvoided(menuItemId);
  if (!exists) {
    await db.avoidances.add(
      toScopedRecord({
        menuItemId,
        updatedAt: Date.now(),
      })
    );
    scheduleProfileStateSync();
  }
}

export async function removeAvoidance(menuItemId: string): Promise<void> {
  const scope = getCurrentPrivateScope();
  const rows = await db.avoidances
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .toArray();
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  if (ids.length > 0) {
    await db.avoidances.bulkDelete(ids);
    scheduleProfileStateSync();
  }
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
