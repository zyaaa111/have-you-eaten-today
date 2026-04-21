import { db } from "./db";
import { getCurrentPrivateScope, isRecordInScope, toScopedRecord } from "./private-scope";
import { scheduleProfileStateSync } from "./profile-state";

export async function getWeight(menuItemId: string): Promise<number> {
  const scope = getCurrentPrivateScope();
  const personal = await db.personalWeights
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .first();
  if (personal) return personal.weight;

  return 1;
}

export async function setWeight(menuItemId: string, weight: number): Promise<void> {
  const scope = getCurrentPrivateScope();
  const existing = await db.personalWeights
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .first();
  if (existing?.id !== undefined) {
    await db.personalWeights.update(existing.id, { weight, updatedAt: Date.now() });
  } else {
    await db.personalWeights.add(
      toScopedRecord({
        menuItemId,
        weight,
        updatedAt: Date.now(),
      })
    );
  }
  scheduleProfileStateSync({ collection: "personalWeights", key: menuItemId });
}

export async function getWeightsMap(menuItemIds: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const scope = getCurrentPrivateScope();

  const personalWeights = await db.personalWeights.where("menuItemId").anyOf(menuItemIds).toArray();
  for (const pw of personalWeights) {
    if (!isRecordInScope(pw, scope)) continue;
    map[pw.menuItemId] = pw.weight;
  }

  for (const id of menuItemIds) {
    if (map[id] === undefined) {
      map[id] = 1;
    }
  }

  return map;
}

export async function deleteWeight(menuItemId: string): Promise<void> {
  const scope = getCurrentPrivateScope();
  const rows = await db.personalWeights
    .where("menuItemId")
    .equals(menuItemId)
    .and((record) => isRecordInScope(record, scope))
    .toArray();
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  if (ids.length > 0) {
    await db.personalWeights.bulkDelete(ids);
    scheduleProfileStateSync({ collection: "personalWeights", key: menuItemId });
  }
}
