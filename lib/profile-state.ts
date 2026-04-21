import { db } from "./db";
import { buildApiUrl } from "./api-base";
import { getLocalSessionUser } from "./auth-client";
import { getCurrentPrivateScope, isRecordInScope } from "./private-scope";
import type { ProfileStateExport } from "./types";

let syncTimer: ReturnType<typeof setTimeout> | null = null;

async function profileFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function migrateLegacyPrivateState(): Promise<void> {
  const scope = getCurrentPrivateScope();
  const now = Date.now();

  const [favoriteIdsRecord, wishIdsRecord] = await Promise.all([
    db.settings.get("favoriteIds"),
    db.settings.get("wishIds"),
  ]);

  const favoriteIds = Array.isArray(favoriteIdsRecord?.value) ? (favoriteIdsRecord.value as string[]) : [];
  const wishIds = Array.isArray(wishIdsRecord?.value) ? (wishIdsRecord.value as string[]) : [];

  await db.transaction(
    "rw",
    [db.avoidances, db.wishes, db.favorites, db.personalWeights, db.menuGroups, db.menuGroupItems],
    async () => {
      const avoidances = await db.avoidances.toArray();
      for (const record of avoidances) {
        if (!record.scope) {
          await db.avoidances.update(record.id!, {
            scope: scope.scope,
            profileId: scope.profileId,
            spaceId: scope.spaceId,
            updatedAt: record.updatedAt ?? now,
          });
        }
      }

      const weights = await db.personalWeights.toArray();
      for (const record of weights) {
        if (!record.scope) {
          await db.personalWeights.update(record.id!, {
            scope: scope.scope,
            profileId: scope.profileId,
            spaceId: scope.spaceId,
            updatedAt: record.updatedAt ?? now,
          });
        }
      }

      const groups = await db.menuGroups.toArray();
      for (const group of groups) {
        const nextScope = group.scope === "profile" ? "profile" : group.scope === "local" ? "local" : scope.scope;
        await db.menuGroups.update(group.id, {
          scope: nextScope,
          profileId: nextScope === "profile" ? scope.profileId : undefined,
          spaceId: nextScope === "profile" ? scope.spaceId : undefined,
          updatedAt: group.updatedAt ?? now,
        });
      }

      const groupItems = await db.menuGroupItems.toArray();
      for (const item of groupItems) {
        if (typeof item.id !== "number") continue;
        await db.menuGroupItems.update(item.id, {
          profileId: scope.profileId,
          spaceId: scope.spaceId,
          updatedAt: item.updatedAt ?? now,
        });
      }

      for (const menuItemId of favoriteIds) {
        const existing = await db.favorites
          .where("[scope+menuItemId]")
          .equals([scope.scope, menuItemId])
          .and((record) => record.profileId === scope.profileId && record.spaceId === scope.spaceId)
          .first();
        if (!existing) {
          await db.favorites.add({
            menuItemId,
            scope: scope.scope,
            profileId: scope.profileId,
            spaceId: scope.spaceId,
            updatedAt: now,
          });
        }
      }

      for (const menuItemId of wishIds) {
        const existing = await db.wishes
          .where("[scope+menuItemId]")
          .equals([scope.scope, menuItemId])
          .and((record) => record.profileId === scope.profileId && record.spaceId === scope.spaceId)
          .first();
        if (!existing) {
          await db.wishes.add({
            menuItemId,
            scope: scope.scope,
            profileId: scope.profileId,
            spaceId: scope.spaceId,
            updatedAt: now,
          });
        }
      }
    }
  );
}

export async function getCurrentProfileState(): Promise<ProfileStateExport> {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId) {
    return {
      avoidances: [],
      wishes: [],
      favorites: [],
      personalWeights: [],
      menuGroups: [],
      menuGroupItems: [],
    };
  }

  const [avoidances, wishes, favorites, personalWeights, menuGroups, menuGroupItems] = await Promise.all([
    db.avoidances.toArray(),
    db.wishes.toArray(),
    db.favorites.toArray(),
    db.personalWeights.toArray(),
    db.menuGroups.toArray(),
    db.menuGroupItems.toArray(),
  ]);

  return {
    avoidances: avoidances.filter((item) => isRecordInScope(item, scope)),
    wishes: wishes.filter((item) => isRecordInScope(item, scope)),
    favorites: favorites.filter((item) => isRecordInScope(item, scope)),
    personalWeights: personalWeights.filter((item) => isRecordInScope(item, scope)),
    menuGroups: menuGroups.filter((item) => isRecordInScope(item, scope)),
    menuGroupItems: menuGroupItems.filter((item) => isRecordInScope(item, scope)),
  };
}

export async function pullCurrentProfileState(): Promise<void> {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId || !getLocalSessionUser()) {
    return;
  }

  const snapshot = await profileFetch<ProfileStateExport>(
    `/sync/profile-state?profile_id=${encodeURIComponent(scope.profileId)}&space_id=${encodeURIComponent(scope.spaceId)}`
  );

  await replaceCurrentScopedState(snapshot, scope.profileId, scope.spaceId);
}

export async function pushCurrentProfileState(): Promise<void> {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId || !getLocalSessionUser()) {
    return;
  }

  const state = await getCurrentProfileState();
  await profileFetch<{ success: boolean }>("/sync/profile-state", {
    method: "PUT",
    body: JSON.stringify({
      profile_id: scope.profileId,
      space_id: scope.spaceId,
      state,
    }),
  });
}

export async function clearCurrentProfileState(): Promise<void> {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId) {
    return;
  }
  await replaceCurrentScopedState(
    {
      avoidances: [],
      wishes: [],
      favorites: [],
      personalWeights: [],
      menuGroups: [],
      menuGroupItems: [],
    },
    scope.profileId,
    scope.spaceId
  );
  await pushCurrentProfileState();
}

export function scheduleProfileStateSync(delay = 250): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushCurrentProfileState().catch((error) => {
      console.error("Profile state sync failed:", error);
    });
  }, delay);
}

async function replaceCurrentScopedState(snapshot: ProfileStateExport, profileId: string, spaceId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.avoidances, db.wishes, db.favorites, db.personalWeights, db.menuGroups, db.menuGroupItems],
    async () => {
      const [avoidances, wishes, favorites, weights, groups, groupItems] = await Promise.all([
        db.avoidances.toArray(),
        db.wishes.toArray(),
        db.favorites.toArray(),
        db.personalWeights.toArray(),
        db.menuGroups.toArray(),
        db.menuGroupItems.toArray(),
      ]);

      const groupIds = new Set(groups.filter((group) => group.profileId === profileId && group.spaceId === spaceId).map((group) => group.id));

      await Promise.all([
        db.avoidances.bulkDelete(avoidances.filter((item) => item.profileId === profileId && item.spaceId === spaceId).map((item) => item.id!).filter((id): id is number => typeof id === "number")),
        db.wishes.bulkDelete(wishes.filter((item) => item.profileId === profileId && item.spaceId === spaceId).map((item) => item.id!).filter((id): id is number => typeof id === "number")),
        db.favorites.bulkDelete(favorites.filter((item) => item.profileId === profileId && item.spaceId === spaceId).map((item) => item.id!).filter((id): id is number => typeof id === "number")),
        db.personalWeights.bulkDelete(weights.filter((item) => item.profileId === profileId && item.spaceId === spaceId).map((item) => item.id!).filter((id): id is number => typeof id === "number")),
        db.menuGroups.bulkDelete(Array.from(groupIds)),
        db.menuGroupItems.bulkDelete(groupItems.filter((item) => item.profileId === profileId && item.spaceId === spaceId).map((item) => item.id!).filter((id): id is number => typeof id === "number")),
      ]);

      if (snapshot.avoidances.length > 0) await db.avoidances.bulkAdd(snapshot.avoidances);
      if (snapshot.wishes.length > 0) await db.wishes.bulkAdd(snapshot.wishes);
      if (snapshot.favorites.length > 0) await db.favorites.bulkAdd(snapshot.favorites);
      if (snapshot.personalWeights.length > 0) await db.personalWeights.bulkAdd(snapshot.personalWeights);
      if (snapshot.menuGroups.length > 0) await db.menuGroups.bulkAdd(snapshot.menuGroups);
      if (snapshot.menuGroupItems.length > 0) await db.menuGroupItems.bulkAdd(snapshot.menuGroupItems);
    }
  );
}
