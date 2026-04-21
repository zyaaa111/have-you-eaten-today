import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import type { MenuGroup, MenuGroupItem } from "./types";
import { getCurrentPrivateScope, isRecordInScope } from "./private-scope";
import { scheduleProfileStateSync } from "./profile-state";

export async function createMenuGroup(name: string): Promise<MenuGroup> {
  const scope = getCurrentPrivateScope();
  const existingCount = (await db.menuGroups.toArray()).filter((group) => isRecordInScope(group, scope)).length;
  const group: MenuGroup = {
    id: uuidv4(),
    name: name.trim(),
    scope: scope.scope,
    profileId: scope.profileId,
    spaceId: scope.spaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sortOrder: existingCount,
  };
  await db.menuGroups.add(group);
  scheduleProfileStateSync({ collection: "menuGroups", key: group.id });
  return group;
}

export async function renameMenuGroup(groupId: string, name: string): Promise<void> {
  await db.menuGroups.update(groupId, {
    name: name.trim(),
    updatedAt: Date.now(),
  });
  scheduleProfileStateSync({ collection: "menuGroups", key: groupId });
}

export async function deleteMenuGroup(groupId: string): Promise<void> {
  const items = await db.menuGroupItems.where("groupId").equals(groupId).toArray();
  await db.transaction("rw", [db.menuGroups, db.menuGroupItems], async () => {
    await db.menuGroupItems.where("groupId").equals(groupId).delete();
    await db.menuGroups.delete(groupId);
  });
  scheduleProfileStateSync([
    { collection: "menuGroups", key: groupId },
    ...items.map((item) => ({ collection: "menuGroupItems" as const, key: `${item.groupId}:${item.menuItemId}` })),
  ]);
}

export async function addMenuItemToGroup(groupId: string, menuItemId: string): Promise<void> {
  const existing = await db.menuGroupItems.where("[groupId+menuItemId]").equals([groupId, menuItemId]).first();
  if (existing) return;
  const group = await db.menuGroups.get(groupId);
  if (!group) return;
  const count = await db.menuGroupItems.where("groupId").equals(groupId).count();
  const item: MenuGroupItem = {
    groupId,
    menuItemId,
    profileId: group?.profileId,
    spaceId: group?.spaceId,
    createdAt: Date.now(),
    sortOrder: count,
    updatedAt: Date.now(),
  };
  await db.menuGroupItems.add(item);
  await db.menuGroups.update(groupId, { updatedAt: Date.now() });
  scheduleProfileStateSync([
    { collection: "menuGroups", key: groupId },
    { collection: "menuGroupItems", key: `${groupId}:${menuItemId}` },
  ]);
}

export async function removeMenuItemFromGroup(groupId: string, menuItemId: string): Promise<void> {
  await db.menuGroupItems.where("[groupId+menuItemId]").equals([groupId, menuItemId]).delete();
  await db.menuGroups.update(groupId, { updatedAt: Date.now() });
  scheduleProfileStateSync([
    { collection: "menuGroups", key: groupId },
    { collection: "menuGroupItems", key: `${groupId}:${menuItemId}` },
  ]);
}

export async function moveMenuGroupItem(groupId: string, menuItemId: string, direction: -1 | 1): Promise<void> {
  const items = await db.menuGroupItems.where("groupId").equals(groupId).sortBy("sortOrder");
  const currentIndex = items.findIndex((item) => item.menuItemId === menuItemId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) return;

  const current = items[currentIndex]!;
  const target = items[nextIndex]!;

  await db.transaction("rw", db.menuGroupItems, async () => {
    if (typeof current.id === "number" && typeof target.id === "number") {
      await db.menuGroupItems.update(current.id, { sortOrder: target.sortOrder, updatedAt: Date.now() });
      await db.menuGroupItems.update(target.id, { sortOrder: current.sortOrder, updatedAt: Date.now() });
    }
  });
  scheduleProfileStateSync([
    { collection: "menuGroups", key: groupId },
    { collection: "menuGroupItems", key: `${groupId}:${current.menuItemId}` },
    { collection: "menuGroupItems", key: `${groupId}:${target.menuItemId}` },
  ]);
}
