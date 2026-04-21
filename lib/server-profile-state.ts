import { db } from "./db-server";
import type {
  AvoidanceRecord,
  FavoriteRecord,
  MenuGroup,
  MenuGroupItem,
  PersonalWeight,
  ProfileStateExport,
  WishRecord,
} from "./types";

export function getProfileState(profileId: string, spaceId: string): ProfileStateExport {
  const avoidances = db.prepare(
    "SELECT menu_item_id, updated_at FROM profile_avoidances WHERE profile_id = ? AND space_id = ?"
  ).all(profileId, spaceId) as Array<{ menu_item_id: string; updated_at: number }>;
  const wishes = db.prepare(
    "SELECT menu_item_id, updated_at FROM profile_wishes WHERE profile_id = ? AND space_id = ?"
  ).all(profileId, spaceId) as Array<{ menu_item_id: string; updated_at: number }>;
  const favorites = db.prepare(
    "SELECT menu_item_id, updated_at FROM profile_favorites WHERE profile_id = ? AND space_id = ?"
  ).all(profileId, spaceId) as Array<{ menu_item_id: string; updated_at: number }>;
  const weights = db.prepare(
    "SELECT menu_item_id, weight, updated_at FROM profile_weights WHERE profile_id = ? AND space_id = ?"
  ).all(profileId, spaceId) as Array<{ menu_item_id: string; weight: number; updated_at: number }>;
  const groups = db.prepare(
    "SELECT id, name, created_at, updated_at, sort_order FROM profile_groups WHERE profile_id = ? AND space_id = ? ORDER BY sort_order ASC"
  ).all(profileId, spaceId) as Array<{
    id: string;
    name: string;
    created_at: number;
    updated_at: number;
    sort_order: number;
  }>;
  const groupItems = db.prepare(
    "SELECT group_id, menu_item_id, created_at, updated_at, sort_order FROM profile_group_items WHERE profile_id = ? ORDER BY sort_order ASC"
  ).all(profileId) as Array<{
    group_id: string;
    menu_item_id: string;
    created_at: number;
    updated_at: number;
    sort_order: number;
  }>;

  return {
    avoidances: avoidances.map<AvoidanceRecord>((row) => ({
      menuItemId: row.menu_item_id,
      scope: "profile",
      profileId,
      spaceId,
      updatedAt: row.updated_at,
    })),
    wishes: wishes.map<WishRecord>((row) => ({
      menuItemId: row.menu_item_id,
      scope: "profile",
      profileId,
      spaceId,
      updatedAt: row.updated_at,
    })),
    favorites: favorites.map<FavoriteRecord>((row) => ({
      menuItemId: row.menu_item_id,
      scope: "profile",
      profileId,
      spaceId,
      updatedAt: row.updated_at,
    })),
    personalWeights: weights.map<PersonalWeight>((row) => ({
      menuItemId: row.menu_item_id,
      weight: row.weight,
      scope: "profile",
      profileId,
      spaceId,
      updatedAt: row.updated_at,
    })),
    menuGroups: groups.map<MenuGroup>((row) => ({
      id: row.id,
      name: row.name,
      scope: "profile",
      profileId,
      spaceId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sortOrder: row.sort_order,
    })),
    menuGroupItems: groupItems.map<MenuGroupItem>((row) => ({
      groupId: row.group_id,
      menuItemId: row.menu_item_id,
      profileId,
      spaceId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sortOrder: row.sort_order,
    })),
  };
}

export function replaceProfileState(profileId: string, spaceId: string, state: ProfileStateExport): void {
  db.transaction(() => {
    db.prepare("DELETE FROM profile_avoidances WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_wishes WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_weights WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_favorites WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_group_items WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM profile_groups WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);

    const insertAvoidance = db.prepare(
      "INSERT INTO profile_avoidances (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertWish = db.prepare(
      "INSERT INTO profile_wishes (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertFavorite = db.prepare(
      "INSERT INTO profile_favorites (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertWeight = db.prepare(
      "INSERT INTO profile_weights (profile_id, space_id, menu_item_id, weight, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertGroup = db.prepare(
      "INSERT INTO profile_groups (id, profile_id, space_id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertGroupItem = db.prepare(
      "INSERT INTO profile_group_items (id, group_id, profile_id, menu_item_id, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const item of state.avoidances) {
      insertAvoidance.run(profileId, spaceId, item.menuItemId, item.updatedAt ?? Date.now());
    }
    for (const item of state.wishes) {
      insertWish.run(profileId, spaceId, item.menuItemId, item.updatedAt ?? Date.now());
    }
    for (const item of state.favorites) {
      insertFavorite.run(profileId, spaceId, item.menuItemId, item.updatedAt ?? Date.now());
    }
    for (const item of state.personalWeights) {
      insertWeight.run(profileId, spaceId, item.menuItemId, item.weight, item.updatedAt ?? Date.now());
    }
    for (const group of state.menuGroups) {
      insertGroup.run(
        group.id,
        profileId,
        spaceId,
        group.name,
        group.createdAt,
        group.updatedAt,
        group.sortOrder
      );
    }
    for (const item of state.menuGroupItems) {
      insertGroupItem.run(
        `${item.groupId}:${item.menuItemId}`,
        item.groupId,
        profileId,
        item.menuItemId,
        item.createdAt,
        item.updatedAt ?? item.createdAt,
        item.sortOrder
      );
    }
  })();
}
