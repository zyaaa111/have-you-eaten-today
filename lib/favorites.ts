import { db } from "./db";
import { getCurrentPrivateScope, isRecordInScope, toScopedRecord } from "./private-scope";
import { scheduleProfileStateSync } from "./profile-state";

export async function getFavoriteIds(): Promise<string[]> {
  const scope = getCurrentPrivateScope();
  const rows = await db.favorites.toArray();
  return rows.filter((record) => isRecordInScope(record, scope)).map((record) => record.menuItemId);
}

export async function toggleFavoriteId(menuItemId: string): Promise<boolean> {
  const scope = getCurrentPrivateScope();
  const existing = await db.favorites
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .first();
  if (existing?.id !== undefined) {
    await db.favorites.delete(existing.id);
    scheduleProfileStateSync({ collection: "favorites", key: menuItemId });
    return false;
  }

  await db.favorites.add(
    toScopedRecord({
      menuItemId,
      updatedAt: Date.now(),
    })
  );
  scheduleProfileStateSync({ collection: "favorites", key: menuItemId });
  return true;
}

export async function isFavorite(menuItemId: string): Promise<boolean> {
  const ids = await getFavoriteIds();
  return ids.includes(menuItemId);
}
