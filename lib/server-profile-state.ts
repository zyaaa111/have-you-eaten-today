import { db } from "./db-server";
import { normalizeProfileSetting } from "./syncable-settings";
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

export function getProfileState(profileId: string, spaceId: string): ProfileStateExport {
  const settings = db.prepare(
    "SELECT key, value, updated_at FROM profile_settings WHERE profile_id = ? AND space_id = ?"
  ).all(profileId, spaceId) as Array<{ key: string; value: string; updated_at: number }>;
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
    `SELECT profile_group_items.group_id, profile_group_items.menu_item_id, profile_group_items.created_at,
            profile_group_items.updated_at, profile_group_items.sort_order
     FROM profile_group_items
     JOIN profile_groups
       ON profile_groups.id = profile_group_items.group_id
      AND profile_groups.profile_id = profile_group_items.profile_id
     WHERE profile_group_items.profile_id = ?
       AND profile_groups.space_id = ?
     ORDER BY profile_group_items.sort_order ASC`
  ).all(profileId, spaceId) as Array<{
    group_id: string;
    menu_item_id: string;
    created_at: number;
    updated_at: number;
    sort_order: number;
  }>;
  const rollHistory = db.prepare(
    "SELECT id, rolled_at, items, rule_snapshot, ignored_dedup FROM profile_roll_history WHERE profile_id = ? AND space_id = ? ORDER BY rolled_at DESC LIMIT 500"
  ).all(profileId, spaceId) as Array<{
    id: string;
    rolled_at: number;
    items: string;
    rule_snapshot: string;
    ignored_dedup: number;
  }>;

  return {
    settings: settings
      .map<AppSettingRecord | null>((row) => {
        try {
          return normalizeProfileSetting({
            key: row.key,
            value: JSON.parse(row.value) as unknown,
            updatedAt: row.updated_at,
          });
        } catch {
          return null;
        }
      })
      .filter((setting): setting is AppSettingRecord => !!setting),
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
    rollHistory: rollHistory.map<RollHistory>((row) => {
      let items: RollHistory["items"] = [];
      try {
        items = JSON.parse(row.items) as RollHistory["items"];
      } catch {
        items = [];
      }
      return {
        id: row.id,
        rolledAt: row.rolled_at,
        items,
        ruleSnapshot: row.rule_snapshot,
        ignoredDedup: Boolean(row.ignored_dedup),
      };
    }),
  };
}

export function replaceProfileState(profileId: string, spaceId: string, state: ProfileStateExport): void {
  db.transaction(() => {
    const shouldReplaceSettings = Array.isArray(state.settings);
    db.prepare("DELETE FROM profile_avoidances WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_wishes WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_weights WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_favorites WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    if (shouldReplaceSettings) {
      db.prepare("DELETE FROM profile_settings WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    }
    db.prepare(
      `DELETE FROM profile_group_items
       WHERE profile_id = ?
         AND group_id IN (
           SELECT id FROM profile_groups WHERE profile_id = ? AND space_id = ?
         )`
    ).run(profileId, profileId, spaceId);
    db.prepare("DELETE FROM profile_groups WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);
    db.prepare("DELETE FROM profile_roll_history WHERE profile_id = ? AND space_id = ?").run(profileId, spaceId);

    const insertAvoidance = db.prepare(
      "INSERT INTO profile_avoidances (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertWish = db.prepare(
      "INSERT INTO profile_wishes (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertFavorite = db.prepare(
      "INSERT INTO profile_favorites (profile_id, space_id, menu_item_id, updated_at) VALUES (?, ?, ?, ?)"
    );
    const insertSetting = db.prepare(
      "INSERT INTO profile_settings (profile_id, space_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)"
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
    const insertRollHistory = db.prepare(
      "INSERT INTO profile_roll_history (id, profile_id, space_id, rolled_at, items, rule_snapshot, ignored_dedup) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    if (shouldReplaceSettings) {
      for (const setting of state.settings ?? []) {
        const normalized = normalizeProfileSetting(setting);
        if (!normalized) continue;
        insertSetting.run(
          profileId,
          spaceId,
          normalized.key,
          JSON.stringify(normalized.value),
          normalized.updatedAt ?? Date.now()
        );
      }
    }
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
    for (const item of state.rollHistory ?? []) {
      insertRollHistory.run(
        item.id,
        profileId,
        spaceId,
        item.rolledAt,
        JSON.stringify(item.items ?? []),
        item.ruleSnapshot,
        item.ignoredDedup ? 1 : 0
      );
    }
  })();
}
