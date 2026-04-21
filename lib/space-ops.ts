import { db } from "./db";
import type { MenuItem, Tag, ComboTemplate } from "./types";
import { getLocalIdentity } from "./identity";
import { scheduleProfileStateSync, type ProfileStateDirtyChange } from "./profile-state";

export function getCurrentSpaceId(): string | undefined {
  return getLocalIdentity()?.space.id;
}

export function getCurrentProfileId(): string | undefined {
  return getLocalIdentity()?.profile.id;
}

export function hasSpace(): boolean {
  return !!getLocalIdentity();
}

export function enrich<T extends { spaceId?: string; profileId?: string; syncStatus?: string; version?: number }>(
  obj: Omit<T, "spaceId" | "profileId" | "syncStatus" | "version">,
  overrides?: Partial<T>
): T {
  const spaceId = getCurrentSpaceId();
  const profileId = getCurrentProfileId();
  return {
    ...obj,
    spaceId,
    profileId,
    syncStatus: "pending",
    version: 1,
    ...overrides,
  } as T;
}

export async function detachSpaceData(spaceId: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.menuItems, db.tags, db.comboTemplates, db.likes, db.comments, db.pendingDeletions, db.tagMappings],
    async () => {
      await db.menuItems.toCollection().modify((item) => {
        if (item.spaceId === spaceId) {
          item.spaceId = undefined;
          item.profileId = undefined;
          item.syncStatus = "local";
          item.version = 1;
        }
      });

      await db.tags.toCollection().modify((item) => {
        if (item.spaceId === spaceId) {
          item.spaceId = undefined;
          item.profileId = undefined;
          item.syncStatus = "local";
          item.version = 1;
        }
      });

      await db.comboTemplates.toCollection().modify((item) => {
        if (item.spaceId === spaceId) {
          item.spaceId = undefined;
          item.profileId = undefined;
          item.syncStatus = "local";
          item.version = 1;
        }
      });

      await db.likes.where("spaceId").equals(spaceId).delete();
      await db.comments.where("spaceId").equals(spaceId).delete();
      await db.pendingDeletions.where("spaceId").equals(spaceId).delete();
      await db.tagMappings.where("spaceId").equals(spaceId).delete();
    }
  );
}

export async function attachLocalDataToSpace(spaceId: string, profileId: string): Promise<void> {
  await db.transaction("rw", [db.menuItems, db.tags, db.comboTemplates], async () => {
    await db.menuItems.toCollection().modify((item) => {
      if (!item.spaceId) {
        item.spaceId = spaceId;
        item.profileId = profileId;
        item.syncStatus = "pending";
        item.version = 1;
      }
    });

    await db.tags.toCollection().modify((item) => {
      if (!item.spaceId) {
        item.spaceId = spaceId;
        item.profileId = profileId;
        item.syncStatus = "pending";
        item.version = 1;
      }
    });

    await db.comboTemplates.toCollection().modify((item) => {
      if (!item.spaceId) {
        item.spaceId = spaceId;
        item.profileId = profileId;
        item.syncStatus = "pending";
        item.version = 1;
      }
    });
  });
}

// Menu Items
export async function createMenuItem(item: Omit<MenuItem, "id" | "spaceId" | "profileId" | "syncStatus" | "version"> & { id: string }): Promise<void> {
  await db.menuItems.add(enrich(item));
}

export async function updateMenuItem(id: string, changes: Partial<MenuItem>): Promise<void> {
  const local = await db.menuItems.get(id);
  const spaceId = getCurrentSpaceId();
  const profileId = getCurrentProfileId();
  const patch: Partial<MenuItem> = { ...changes, syncStatus: "pending", version: (local?.version ?? 1) + 1 };
  if (spaceId && !local?.spaceId) {
    patch.spaceId = spaceId;
    patch.profileId = profileId;
  }
  await db.menuItems.update(id, patch);
}

export async function deleteMenuItem(id: string): Promise<void> {
  const spaceId = getCurrentSpaceId();
  const groupItems = await db.menuGroupItems.where({ menuItemId: id }).toArray();
  await db.transaction(
    "rw",
    [db.menuItems, db.personalWeights, db.avoidances, db.wishes, db.favorites, db.menuGroupItems, db.likes, db.comments, db.pendingDeletions],
    async () => {
    await db.menuItems.delete(id);
    await db.personalWeights.where({ menuItemId: id }).delete();
    await db.avoidances.where({ menuItemId: id }).delete();
    await db.wishes.where({ menuItemId: id }).delete();
    await db.favorites.where({ menuItemId: id }).delete();
    await db.menuGroupItems.where({ menuItemId: id }).delete();
    await db.likes.where({ menuItemId: id }).delete();
    await db.comments.where({ menuItemId: id }).delete();
    if (spaceId) {
      await db.pendingDeletions.add({
        tableName: "menu_items",
        recordId: id,
        spaceId,
        createdAt: Date.now(),
      });
    }
    }
  );
  const privateChanges: ProfileStateDirtyChange[] = [
    { collection: "personalWeights", key: id },
    { collection: "avoidances", key: id },
    { collection: "wishes", key: id },
    { collection: "favorites", key: id },
    ...groupItems.map((item) => ({ collection: "menuGroupItems" as const, key: `${item.groupId}:${item.menuItemId}` })),
  ];
  scheduleProfileStateSync(privateChanges);
}

// Tags
export async function createTag(tag: Omit<Tag, "spaceId" | "profileId" | "syncStatus" | "version">): Promise<void> {
  await db.tags.add(enrich({ ...tag, updatedAt: tag.updatedAt ?? tag.createdAt }));
}

export async function updateTag(id: string, changes: Partial<Tag>): Promise<void> {
  const local = await db.tags.get(id);
  const spaceId = getCurrentSpaceId();
  const profileId = getCurrentProfileId();
  const patch: Partial<Tag> = { ...changes, updatedAt: Date.now(), syncStatus: "pending", version: (local?.version ?? 1) + 1 };
  if (spaceId && !local?.spaceId) {
    patch.spaceId = spaceId;
    patch.profileId = profileId;
  }
  await db.tags.update(id, patch);
}

export async function deleteTag(id: string): Promise<void> {
  const spaceId = getCurrentSpaceId();
  await db.tags.delete(id);
  if (spaceId) {
    await db.pendingDeletions.add({
      tableName: "tags",
      recordId: id,
      spaceId,
      createdAt: Date.now(),
    });
  }
}

// Combo Templates
export async function createComboTemplate(template: Omit<ComboTemplate, "spaceId" | "profileId" | "syncStatus" | "version">): Promise<void> {
  await db.comboTemplates.add(enrich({ ...template, updatedAt: template.updatedAt ?? template.createdAt }));
}

export async function updateComboTemplate(id: string, changes: Partial<ComboTemplate>): Promise<void> {
  const local = await db.comboTemplates.get(id);
  const spaceId = getCurrentSpaceId();
  const profileId = getCurrentProfileId();
  const patch: Partial<ComboTemplate> = { ...changes, updatedAt: Date.now(), syncStatus: "pending", version: (local?.version ?? 1) + 1 };
  if (spaceId && !local?.spaceId) {
    patch.spaceId = spaceId;
    patch.profileId = profileId;
  }
  await db.comboTemplates.update(id, patch);
}

export async function deleteComboTemplate(id: string): Promise<void> {
  const spaceId = getCurrentSpaceId();
  await db.comboTemplates.delete(id);
  if (spaceId) {
    await db.pendingDeletions.add({
      tableName: "combo_templates",
      recordId: id,
      spaceId,
      createdAt: Date.now(),
    });
  }
}
