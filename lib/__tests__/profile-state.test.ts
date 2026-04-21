import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, db } from "@/lib/db";
import { saveLocalIdentity, clearLocalIdentity } from "@/lib/identity";
import { clearLocalSessionUser, saveLocalSessionUser } from "@/lib/auth-client";
import { pullCurrentProfileState } from "@/lib/profile-state";
import type { ProfileStateExport } from "@/lib/types";

const testSpace = {
  id: "profile-state-space",
  inviteCode: "PSTATE",
  name: "Profile State Space",
  createdAt: 1,
  updatedAt: 1,
};

const testProfile = {
  id: "profile-state-profile",
  spaceId: testSpace.id,
  nickname: "同步测试",
  joinedAt: 1,
};

function emptyState(overrides: Partial<ProfileStateExport> = {}): ProfileStateExport {
  return {
    settings: [],
    avoidances: [],
    wishes: [],
    favorites: [],
    personalWeights: [],
    menuGroups: [],
    menuGroupItems: [],
    rollHistory: [],
    ...overrides,
  };
}

async function markDirty(value: unknown) {
  const now = Date.now();
  await db.settings.put({ key: "__profileStateDirtyAt", value: now, updatedAt: now });
  await db.settings.put({ key: "__profileStateDirtyChanges", value, updatedAt: now });
}

function restoreIdentity() {
  saveLocalIdentity({ space: testSpace, profile: testProfile });
  saveLocalSessionUser({
    id: "profile-state-user",
    email: "profile-state@example.com",
    createdAt: 1,
    hasPassword: true,
  });
}

describe("profile-state sync", () => {
  beforeEach(async () => {
    await resetDatabase();
    restoreIdentity();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    await resetDatabase();
    clearLocalIdentity();
    clearLocalSessionUser();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("treats a clean remote snapshot as authoritative and removes stale local private state", async () => {
    await db.settings.put({ key: "theme", value: "dark", updatedAt: 100 });
    await db.wishes.add({
      menuItemId: "stale-menu",
      scope: "profile",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      updatedAt: 100,
    });
    await db.rollHistory.add({
      id: "stale-history",
      rolledAt: 100,
      items: [{ menuItemId: "stale-menu", name: "旧历史", kind: "recipe" }],
      ruleSnapshot: "旧历史",
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => emptyState(),
    } as Response);

    await pullCurrentProfileState();

    expect(await db.settings.get("theme")).toBeUndefined();
    expect(await db.wishes.count()).toBe(0);
    expect(await db.rollHistory.count()).toBe(0);
  });

  it("does not resurrect clean local rows when only an unrelated setting is dirty", async () => {
    await db.settings.put({ key: "theme", value: "dark", updatedAt: 300 });
    await db.wishes.add({
      menuItemId: "deleted-on-remote",
      scope: "profile",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      updatedAt: 100,
    });
    await markDirty({
      at: Date.now(),
      changes: { settings: ["theme"] },
      resets: [],
    });

    const pushedStates: ProfileStateExport[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if ((options?.method ?? "GET") === "PUT") {
        pushedStates.push(JSON.parse(String(options?.body)).state as ProfileStateExport);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => emptyState({ settings: [{ key: "theme", value: "default", updatedAt: 100 }] }),
      } as Response);
    });

    await pullCurrentProfileState();

    expect(await db.wishes.count()).toBe(0);
    expect(pushedStates[0]?.settings).toMatchObject([{ key: "theme", value: "dark" }]);
    expect(pushedStates[0]?.wishes).toEqual([]);
  });

  it("propagates dirty deletions without dropping unrelated remote rows", async () => {
    await markDirty({
      at: Date.now(),
      changes: { wishes: ["deleted-wish"] },
      resets: [],
    });

    const pushedStates: ProfileStateExport[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if ((options?.method ?? "GET") === "PUT") {
        pushedStates.push(JSON.parse(String(options?.body)).state as ProfileStateExport);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          emptyState({
            wishes: [
              {
                menuItemId: "deleted-wish",
                scope: "profile",
                profileId: testProfile.id,
                spaceId: testSpace.id,
                updatedAt: 100,
              },
              {
                menuItemId: "kept-wish",
                scope: "profile",
                profileId: testProfile.id,
                spaceId: testSpace.id,
                updatedAt: 100,
              },
            ],
          }),
      } as Response);
    });

    await pullCurrentProfileState();

    expect((await db.wishes.toArray()).map((item) => item.menuItemId)).toEqual(["kept-wish"]);
    expect(pushedStates[0]?.wishes.map((item) => item.menuItemId)).toEqual(["kept-wish"]);
  });

  it("keeps a local parent group when a dirty group item is pulled before remote has the group", async () => {
    const now = Date.now();
    await db.menuGroups.add({
      id: "new-group",
      name: "新场景",
      scope: "profile",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      createdAt: now,
      updatedAt: now,
      sortOrder: 0,
    });
    await db.menuGroupItems.add({
      groupId: "new-group",
      menuItemId: "menu-1",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      createdAt: now,
      updatedAt: now,
      sortOrder: 0,
    });
    await markDirty({
      at: now,
      changes: { menuGroupItems: ["new-group:menu-1"] },
      resets: [],
    });

    const pushedStates: ProfileStateExport[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if ((options?.method ?? "GET") === "PUT") {
        pushedStates.push(JSON.parse(String(options?.body)).state as ProfileStateExport);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => emptyState(),
      } as Response);
    });

    await pullCurrentProfileState();

    expect(await db.menuGroups.get("new-group")).toBeDefined();
    expect(await db.menuGroupItems.where("[groupId+menuItemId]").equals(["new-group", "menu-1"]).first()).toBeDefined();
    expect(pushedStates[0]?.menuGroups.map((group) => group.id)).toEqual(["new-group"]);
    expect(pushedStates[0]?.menuGroupItems.map((item) => `${item.groupId}:${item.menuItemId}`)).toEqual([
      "new-group:menu-1",
    ]);
  });

  it("propagates collection resets such as clearing roll history", async () => {
    await markDirty({
      at: Date.now(),
      changes: {},
      resets: ["rollHistory"],
    });

    const pushedStates: ProfileStateExport[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      if ((options?.method ?? "GET") === "PUT") {
        pushedStates.push(JSON.parse(String(options?.body)).state as ProfileStateExport);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          emptyState({
            rollHistory: [
              {
                id: "remote-history",
                rolledAt: 100,
                items: [{ menuItemId: "remote-menu", name: "远端历史", kind: "recipe" }],
                ruleSnapshot: "远端历史",
              },
            ],
          }),
      } as Response);
    });

    await pullCurrentProfileState();

    expect(await db.rollHistory.count()).toBe(0);
    expect(pushedStates[0]?.rollHistory).toEqual([]);
  });
});
