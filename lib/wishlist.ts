import { db } from "./db";
import { getCurrentPrivateScope, isRecordInScope, toScopedRecord } from "./private-scope";
import { scheduleProfileStateSync } from "./profile-state";

export async function getWishIds(): Promise<string[]> {
  const scope = getCurrentPrivateScope();
  const rows = await db.wishes.toArray();
  return rows.filter((record) => isRecordInScope(record, scope)).map((record) => record.menuItemId);
}

export async function addWishId(menuItemId: string): Promise<void> {
  const ids = await getWishIds();
  if (!ids.includes(menuItemId)) {
    await db.wishes.add(
      toScopedRecord({
        menuItemId,
        updatedAt: Date.now(),
      })
    );
    scheduleProfileStateSync();
  }
}

export async function removeWishId(menuItemId: string): Promise<void> {
  const scope = getCurrentPrivateScope();
  const rows = await db.wishes
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .toArray();
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  if (ids.length > 0) {
    await db.wishes.bulkDelete(ids);
    scheduleProfileStateSync();
  }
}

export async function saveWishIds(ids: string[]): Promise<void> {
  const existingIds = await getWishIds();
  const removedIds = existingIds.filter((id) => !ids.includes(id));
  const addedIds = ids.filter((id) => !existingIds.includes(id));
  await Promise.all([
    ...removedIds.map((menuItemId) => removeWishId(menuItemId)),
    ...addedIds.map((menuItemId) => addWishId(menuItemId)),
  ]);
}

export async function toggleWishId(menuItemId: string): Promise<boolean> {
  const ids = await getWishIds();
  if (ids.includes(menuItemId)) {
    await removeWishId(menuItemId);
    return false;
  }
  await addWishId(menuItemId);
  return true;
}
