import { afterEach, describe, expect, it } from "vitest";
import { db as serverDb } from "@/lib/db-server";
import { getSharedRecommendations } from "@/lib/server-recommendations";

const ids: string[] = [];

function track(id: string): string {
  ids.push(id);
  return id;
}

afterEach(() => {
  for (const id of ids) {
    serverDb.prepare("DELETE FROM profile_weights WHERE profile_id = ? OR space_id = ? OR menu_item_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM profile_wishes WHERE profile_id = ? OR space_id = ? OR menu_item_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM profile_avoidances WHERE profile_id = ? OR space_id = ? OR menu_item_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM likes WHERE profile_id = ? OR space_id = ? OR menu_item_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM comments WHERE profile_id = ? OR space_id = ? OR menu_item_id = ?").run(id, id, id);
    serverDb.prepare("DELETE FROM menu_items WHERE id = ? OR space_id = ? OR profile_id = ?").run(id, id, id);
  }
  ids.length = 0;
});

describe("server recommendations", () => {
  it("averages explicit member weights with missing weights as the default value 1", () => {
    const now = Date.now();
    const spaceId = track(`recommend-space-${now}`);
    const ownerProfileId = track(`recommend-owner-${now}`);
    const participantA = track(`recommend-a-${now}`);
    const participantB = track(`recommend-b-${now}`);
    const menuId = track(`recommend-menu-${now}`);

    serverDb.prepare(
      `INSERT INTO menu_items (id, space_id, profile_id, kind, name, tags, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(menuId, spaceId, ownerProfileId, "recipe", "多人偏好菜", "[]", now, now, 1);
    serverDb.prepare(
      "INSERT INTO profile_weights (profile_id, space_id, menu_item_id, weight, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(participantA, spaceId, menuId, 5, now);

    const [recommendation] = getSharedRecommendations({
      spaceId,
      profileIds: [participantA, participantB],
      limit: 1,
    });

    expect(recommendation?.item.id).toBe(menuId);
    expect(recommendation?.score).toBe(6);
    expect(recommendation?.reasons).toContain("成员平均偏好较高");
    expect(JSON.stringify(recommendation?.reasons)).not.toContain(participantA);
    expect(JSON.stringify(recommendation?.reasons)).not.toContain("5");
  });
});
