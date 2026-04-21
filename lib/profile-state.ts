import { db } from "./db";
import { buildApiUrl } from "./api-base";
import { getLocalSessionUser } from "./auth-client";
import { getCurrentPrivateScope, isRecordInScope } from "./private-scope";
import { PROFILE_SYNCED_SETTING_KEYS, normalizeProfileSetting, notifySettingsChanged } from "./syncable-settings";
import type {
  AppSettingRecord,
  AvoidanceRecord,
  FavoriteRecord,
  MenuGroup,
  MenuGroupItem,
  PersonalWeight,
  ProfileStateExport,
  RollHistory,
  WishRecord,
} from "./types";

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const PROFILE_STATE_DIRTY_KEY = "__profileStateDirtyAt";
const PROFILE_STATE_DIRTY_CHANGES_KEY = "__profileStateDirtyChanges";

type ProfileStateCollection =
  | "settings"
  | "avoidances"
  | "wishes"
  | "favorites"
  | "personalWeights"
  | "menuGroups"
  | "menuGroupItems"
  | "rollHistory";

export type ProfileStateDirtyChange = {
  collection: ProfileStateCollection;
  key?: string;
  reset?: boolean;
};

type ProfileStateDirtyState = {
  at: number;
  full?: boolean;
  changes: Partial<Record<ProfileStateCollection, string[]>>;
  resets: ProfileStateCollection[];
};

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
    return createEmptyProfileState();
  }

  const [settings, avoidances, wishes, favorites, personalWeights, menuGroups, menuGroupItems, rollHistory] = await Promise.all([
    db.settings.toArray(),
    db.avoidances.toArray(),
    db.wishes.toArray(),
    db.favorites.toArray(),
    db.personalWeights.toArray(),
    db.menuGroups.toArray(),
    db.menuGroupItems.toArray(),
    db.rollHistory.orderBy("rolledAt").reverse().limit(500).toArray(),
  ]);

  return {
    settings: normalizeProfileSettings(settings),
    avoidances: avoidances.filter((item) => isRecordInScope(item, scope)),
    wishes: wishes.filter((item) => isRecordInScope(item, scope)),
    favorites: favorites.filter((item) => isRecordInScope(item, scope)),
    personalWeights: personalWeights.filter((item) => isRecordInScope(item, scope)),
    menuGroups: menuGroups.filter((item) => isRecordInScope(item, scope)),
    menuGroupItems: menuGroupItems.filter((item) => isRecordInScope(item, scope)),
    rollHistory,
  };
}

export async function pullCurrentProfileState(): Promise<void> {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId || !getLocalSessionUser()) {
    return;
  }

  const remoteSnapshot = await profileFetch<ProfileStateExport>(
    `/sync/profile-state?profile_id=${encodeURIComponent(scope.profileId)}&space_id=${encodeURIComponent(scope.spaceId)}`
  );
  const dirty = await getProfileStateDirtyState();
  if (!dirty) {
    await replaceCurrentScopedState(withDefaults(remoteSnapshot), scope.profileId, scope.spaceId);
    return;
  }

  const localSnapshot = await getCurrentProfileState();
  const snapshot = mergeProfileState(localSnapshot, withDefaults(remoteSnapshot), dirty);

  await replaceCurrentScopedState(snapshot, scope.profileId, scope.spaceId);
  await profileFetch<{ success: boolean }>("/sync/profile-state", {
    method: "PUT",
    body: JSON.stringify({
      profile_id: scope.profileId,
      space_id: scope.spaceId,
      state: snapshot,
    }),
  });
  await clearProfileStateDirty();
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
  await clearProfileStateDirty();
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
      rollHistory: [],
      settings: [],
    },
    scope.profileId,
    scope.spaceId,
    { preserveSettings: true }
  );
  await pushCurrentProfileState();
}

export function scheduleProfileStateSync(
  changeOrDelay?: ProfileStateDirtyChange | ProfileStateDirtyChange[] | number,
  delay = 250
): void {
  const scope = getCurrentPrivateScope();
  if (scope.scope !== "profile" || !scope.profileId || !scope.spaceId || !getLocalSessionUser()) {
    return;
  }
  const changes = typeof changeOrDelay === "number" ? undefined : changeOrDelay;
  const nextDelay = typeof changeOrDelay === "number" ? changeOrDelay : delay;
  void markProfileStateDirty(changes);
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushCurrentProfileState().catch((error) => {
      console.error("Profile state sync failed:", error);
    });
  }, nextDelay);
}

async function markProfileStateDirty(changes?: ProfileStateDirtyChange | ProfileStateDirtyChange[]): Promise<void> {
  const now = Date.now();
  const current = await getProfileStateDirtyState();
  const next = current ?? { at: now, changes: {}, resets: [] };
  next.at = now;

  const changeList = Array.isArray(changes) ? changes : changes ? [changes] : [];
  if (changeList.length === 0) {
    next.full = true;
  }
  for (const change of changeList) {
    if (change.reset) {
      next.resets = Array.from(new Set([...next.resets, change.collection]));
      continue;
    }
    if (!change.key) {
      next.full = true;
      continue;
    }
    const existing = new Set(next.changes[change.collection] ?? []);
    existing.add(change.key);
    next.changes[change.collection] = Array.from(existing);
  }

  await db.settings.put({ key: PROFILE_STATE_DIRTY_KEY, value: now, updatedAt: now });
  await db.settings.put({ key: PROFILE_STATE_DIRTY_CHANGES_KEY, value: next, updatedAt: now });
}

async function clearProfileStateDirty(): Promise<void> {
  await Promise.all([
    db.settings.delete(PROFILE_STATE_DIRTY_KEY),
    db.settings.delete(PROFILE_STATE_DIRTY_CHANGES_KEY),
  ]);
}

async function getProfileStateDirtyState(): Promise<ProfileStateDirtyState | null> {
  const row = await db.settings.get(PROFILE_STATE_DIRTY_KEY);
  if (typeof row?.value !== "number") return null;
  const changesRow = await db.settings.get(PROFILE_STATE_DIRTY_CHANGES_KEY);
  if (isDirtyState(changesRow?.value)) {
    return changesRow.value;
  }
  return { at: row.value, full: true, changes: {}, resets: [] };
}

async function replaceCurrentScopedState(
  snapshot: ProfileStateExport,
  profileId: string,
  spaceId: string,
  options: { preserveSettings?: boolean } = {}
): Promise<void> {
  await db.transaction(
    "rw",
    [db.settings, db.avoidances, db.wishes, db.favorites, db.personalWeights, db.menuGroups, db.menuGroupItems, db.rollHistory],
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
      await db.rollHistory.clear();

      let didTouchSettings = false;
      if (!options.preserveSettings) {
        await Promise.all(PROFILE_SYNCED_SETTING_KEYS.map((key) => db.settings.delete(key)));
        didTouchSettings = true;
      }
      if (snapshot.avoidances.length > 0) await db.avoidances.bulkAdd(snapshot.avoidances);
      if (snapshot.wishes.length > 0) await db.wishes.bulkAdd(snapshot.wishes);
      if (snapshot.favorites.length > 0) await db.favorites.bulkAdd(snapshot.favorites);
      if (snapshot.personalWeights.length > 0) await db.personalWeights.bulkAdd(snapshot.personalWeights);
      if (snapshot.menuGroups.length > 0) await db.menuGroups.bulkAdd(snapshot.menuGroups);
      if (snapshot.menuGroupItems.length > 0) await db.menuGroupItems.bulkAdd(snapshot.menuGroupItems);
      if ((snapshot.rollHistory ?? []).length > 0) await db.rollHistory.bulkAdd(snapshot.rollHistory);
      const settings = normalizeProfileSettings(snapshot.settings ?? []);
      if (settings.length > 0) {
        await db.settings.bulkPut(settings);
        didTouchSettings = true;
      }
      if (didTouchSettings) {
        notifySettingsChanged();
      }
    }
  );
}

function createEmptyProfileState(): ProfileStateExport {
  return {
    settings: [],
    avoidances: [],
    wishes: [],
    favorites: [],
    personalWeights: [],
    menuGroups: [],
    menuGroupItems: [],
    rollHistory: [],
  };
}

function preferUpdated<T extends { updatedAt?: number }>(candidate: T, existing: T): boolean {
  return (candidate.updatedAt ?? 0) >= (existing.updatedAt ?? 0);
}

function mergeByKey<T>(local: T[] = [], remote: T[] = [], getKey: (item: T) => string, prefer: (candidate: T, existing: T) => boolean): T[] {
  const merged = new Map<string, T>();
  for (const item of remote) {
    merged.set(getKey(item), item);
  }
  for (const item of local) {
    const key = getKey(item);
    const existing = merged.get(key);
    if (!existing || prefer(item, existing)) {
      merged.set(key, item);
    }
  }
  return Array.from(merged.values());
}

function mergeProfileState(
  local: ProfileStateExport,
  remote: ProfileStateExport,
  dirty: ProfileStateDirtyState
): ProfileStateExport {
  if (dirty.full) {
    return mergeFullProfileState(local, remote);
  }

  const menuGroups = mergeDirtyCollection<MenuGroup>(
    local.menuGroups,
    remote.menuGroups,
    (item) => item.id,
    dirty,
    "menuGroups"
  ).sort((a, b) => a.sortOrder - b.sortOrder);
  const groupIds = new Set(menuGroups.map((group) => group.id));

  return {
    settings: mergeDirtyCollection<AppSettingRecord>(
      normalizeProfileSettings(local.settings ?? []),
      normalizeProfileSettings(remote.settings ?? []),
      (item) => item.key,
      dirty,
      "settings"
    ),
    avoidances: mergeDirtyCollection<AvoidanceRecord>(local.avoidances, remote.avoidances, (item) => item.menuItemId, dirty, "avoidances"),
    wishes: mergeDirtyCollection<WishRecord>(local.wishes, remote.wishes, (item) => item.menuItemId, dirty, "wishes"),
    favorites: mergeDirtyCollection<FavoriteRecord>(local.favorites, remote.favorites, (item) => item.menuItemId, dirty, "favorites"),
    personalWeights: mergeDirtyCollection<PersonalWeight>(
      local.personalWeights,
      remote.personalWeights,
      (item) => item.menuItemId,
      dirty,
      "personalWeights"
    ),
    menuGroups,
    menuGroupItems: mergeDirtyCollection<MenuGroupItem>(
      local.menuGroupItems,
      remote.menuGroupItems,
      (item) => `${item.groupId}:${item.menuItemId}`,
      dirty,
      "menuGroupItems"
    ).filter((item) => groupIds.has(item.groupId)).sort((a, b) => a.sortOrder - b.sortOrder),
    rollHistory: mergeDirtyCollection<RollHistory>(
      local.rollHistory ?? [],
      remote.rollHistory ?? [],
      (item) => item.id,
      dirty,
      "rollHistory"
    ).sort((a, b) => b.rolledAt - a.rolledAt).slice(0, 500),
  };
}

function mergeFullProfileState(local: ProfileStateExport, remote: ProfileStateExport): ProfileStateExport {
  return {
    settings: mergeByKey<AppSettingRecord>(
      normalizeProfileSettings(local.settings ?? []),
      normalizeProfileSettings(remote.settings ?? []),
      (item) => item.key,
      (candidate, existing) => (candidate.updatedAt ?? 0) >= (existing.updatedAt ?? 0)
    ),
    avoidances: mergeByKey<AvoidanceRecord>(local.avoidances, remote.avoidances, (item) => item.menuItemId, preferUpdated),
    wishes: mergeByKey<WishRecord>(local.wishes, remote.wishes, (item) => item.menuItemId, preferUpdated),
    favorites: mergeByKey<FavoriteRecord>(local.favorites, remote.favorites, (item) => item.menuItemId, preferUpdated),
    personalWeights: mergeByKey<PersonalWeight>(
      local.personalWeights,
      remote.personalWeights,
      (item) => item.menuItemId,
      preferUpdated
    ),
    menuGroups: mergeByKey<MenuGroup>(local.menuGroups, remote.menuGroups, (item) => item.id, preferUpdated).sort(
      (a, b) => a.sortOrder - b.sortOrder
    ),
    menuGroupItems: mergeByKey<MenuGroupItem>(
      local.menuGroupItems,
      remote.menuGroupItems,
      (item) => `${item.groupId}:${item.menuItemId}`,
      (candidate, existing) => (candidate.updatedAt ?? candidate.createdAt ?? 0) >= (existing.updatedAt ?? existing.createdAt ?? 0)
    ).sort((a, b) => a.sortOrder - b.sortOrder),
    rollHistory: mergeByKey<RollHistory>(
      local.rollHistory ?? [],
      remote.rollHistory ?? [],
      (item) => item.id,
      (candidate, existing) => candidate.rolledAt >= existing.rolledAt
    ).sort((a, b) => b.rolledAt - a.rolledAt).slice(0, 500),
  };
}

function mergeDirtyCollection<T>(
  local: T[] = [],
  remote: T[] = [],
  getKey: (item: T) => string,
  dirty: ProfileStateDirtyState,
  collection: ProfileStateCollection
): T[] {
  if (dirty.resets.includes(collection)) {
    return local;
  }

  const dirtyKeys = dirty.changes[collection] ?? [];
  if (dirtyKeys.length === 0) {
    return remote;
  }

  const localByKey = new Map(local.map((item) => [getKey(item), item]));
  const merged = new Map(remote.map((item) => [getKey(item), item]));
  for (const key of dirtyKeys) {
    merged.delete(key);
    const localItem = localByKey.get(key);
    if (localItem) {
      merged.set(key, localItem);
    }
  }
  return Array.from(merged.values());
}

function isDirtyState(value: unknown): value is ProfileStateDirtyState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProfileStateDirtyState>;
  return (
    typeof candidate.at === "number" &&
    !!candidate.changes &&
    typeof candidate.changes === "object" &&
    Array.isArray(candidate.resets)
  );
}

function normalizeProfileSettings(settings: AppSettingRecord[] = []): AppSettingRecord[] {
  return settings
    .map((setting) => normalizeProfileSetting(setting))
    .filter((setting): setting is AppSettingRecord => !!setting);
}

function withDefaults(state: ProfileStateExport): ProfileStateExport {
  return {
    settings: state.settings ?? [],
    avoidances: state.avoidances ?? [],
    wishes: state.wishes ?? [],
    favorites: state.favorites ?? [],
    personalWeights: state.personalWeights ?? [],
    menuGroups: state.menuGroups ?? [],
    menuGroupItems: state.menuGroupItems ?? [],
    rollHistory: state.rollHistory ?? [],
  };
}
