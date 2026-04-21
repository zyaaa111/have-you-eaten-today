import { afterEach, describe, expect, it } from "vitest";
import { db as serverDb } from "@/lib/db-server";
import { getProfileState, replaceProfileState } from "@/lib/server-profile-state";

const touchedIds: string[] = [];

function track(id: string): string {
  touchedIds.push(id);
  return id;
}

function cleanup() {
  for (const id of touchedIds) {
    serverDb.prepare("DELETE FROM profile_group_items WHERE id = ? OR group_id = ? OR profile_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM profile_groups WHERE id = ? OR profile_id = ?").run(id, id);
    serverDb.prepare("DELETE FROM profile_roll_history WHERE id = ? OR profile_id = ?").run(id, id);
    serverDb.prepare("DELETE FROM profile_settings WHERE profile_id = ?").run(id);
    serverDb.prepare("DELETE FROM profile_avoidances WHERE profile_id = ?").run(id);
    serverDb.prepare("DELETE FROM profile_wishes WHERE profile_id = ?").run(id);
    serverDb.prepare("DELETE FROM profile_weights WHERE profile_id = ?").run(id);
    serverDb.prepare("DELETE FROM profile_favorites WHERE profile_id = ?").run(id);
  }
  touchedIds.length = 0;
}

afterEach(() => {
  cleanup();
});

describe("server profile-state", () => {
  it("scopes profile group items to the requested space", () => {
    const now = Date.now();
    const profileId = track(`profile-state-profile-${now}`);
    const spaceA = track(`profile-state-space-a-${now}`);
    const spaceB = track(`profile-state-space-b-${now}`);
    const groupA = track(`profile-state-group-a-${now}`);
    const groupB = track(`profile-state-group-b-${now}`);
    const itemA = track(`profile-state-item-a-${now}`);
    const itemB = track(`profile-state-item-b-${now}`);

    serverDb.prepare(
      "INSERT INTO profile_groups (id, profile_id, space_id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(groupA, profileId, spaceA, "A", now, now, 0);
    serverDb.prepare(
      "INSERT INTO profile_groups (id, profile_id, space_id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(groupB, profileId, spaceB, "B", now, now, 0);
    serverDb.prepare(
      "INSERT INTO profile_group_items (id, group_id, profile_id, menu_item_id, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(itemA, groupA, profileId, "menu-a", now, now, 0);
    serverDb.prepare(
      "INSERT INTO profile_group_items (id, group_id, profile_id, menu_item_id, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(itemB, groupB, profileId, "menu-b", now, now, 0);

    const stateA = getProfileState(profileId, spaceA);
    expect(stateA.menuGroupItems.map((item) => item.menuItemId)).toEqual(["menu-a"]);

    replaceProfileState(profileId, spaceA, {
      settings: [],
      avoidances: [],
      wishes: [],
      favorites: [],
      personalWeights: [],
      menuGroups: [],
      menuGroupItems: [],
      rollHistory: [],
    });

    expect(serverDb.prepare("SELECT id FROM profile_group_items WHERE id = ?").get(itemA)).toBeUndefined();
    expect(serverDb.prepare("SELECT id FROM profile_group_items WHERE id = ?").get(itemB)).toBeDefined();
  });
});
