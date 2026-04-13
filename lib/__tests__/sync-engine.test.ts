import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDatabase, db } from "../db";
import { saveLocalIdentity } from "../supabase";
import type { Space, Profile, MenuItem } from "../types";
import {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createTag,
  deleteTag,
  createComboTemplate,
  deleteComboTemplate,
} from "../space-ops";
import { HttpSyncEngine } from "../http-sync-engine";

const testSpace: Space = {
  id: "space_test_1",
  inviteCode: "TEST01",
  name: "测试空间",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const testProfile: Profile = {
  id: "profile_test_1",
  spaceId: testSpace.id,
  nickname: "测试用户",
  joinedAt: Date.now(),
};

describe("space-ops", () => {
  beforeEach(async () => {
    await resetDatabase();
    saveLocalIdentity({ space: testSpace, profile: testProfile });
  });

  it("should create menu item with pending sync status and space info", async () => {
    await createMenuItem({
      id: "m1",
      kind: "recipe",
      name: "红烧肉",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const item = await db.menuItems.get("m1");
    expect(item).toBeDefined();
    expect(item?.syncStatus).toBe("pending");
    expect(item?.spaceId).toBe(testSpace.id);
    expect(item?.profileId).toBe(testProfile.id);
    expect(item?.version).toBe(1);
  });

  it("should bump version on menu item update", async () => {
    await createMenuItem({
      id: "m2",
      kind: "recipe",
      name: "红烧肉",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await updateMenuItem("m2", { name: "东坡肉" });
    const item = await db.menuItems.get("m2");
    expect(item?.version).toBe(2);
    expect(item?.syncStatus).toBe("pending");
    expect(item?.name).toBe("东坡肉");
  });

  it("should record pending deletion for menu item", async () => {
    await createMenuItem({
      id: "m3",
      kind: "takeout",
      name: "汉堡",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await deleteMenuItem("m3");
    const item = await db.menuItems.get("m3");
    expect(item).toBeUndefined();
    const dels = await db.pendingDeletions.toArray();
    expect(dels.length).toBe(1);
    expect(dels[0].tableName).toBe("menu_items");
    expect(dels[0].recordId).toBe("m3");
    expect(dels[0].spaceId).toBe(testSpace.id);
  });

  it("should create tag with pending sync status", async () => {
    await createTag({
      id: "t1",
      name: "川菜",
      type: "cuisine",
      createdAt: Date.now(),
    });
    const tag = await db.tags.get("t1");
    expect(tag?.syncStatus).toBe("pending");
    expect(tag?.spaceId).toBe(testSpace.id);
  });

  it("should record pending deletion for tag", async () => {
    await createTag({ id: "t2", name: "湘菜", type: "cuisine", createdAt: Date.now() });
    await deleteTag("t2");
    const dels = await db.pendingDeletions.toArray();
    expect(dels.some((d) => d.tableName === "tags" && d.recordId === "t2")).toBe(true);
  });

  it("should create combo template with pending sync status", async () => {
    await createComboTemplate({
      id: "ct1",
      name: "一荤一素",
      rules: [{ count: 1, kind: "recipe" }],
      isBuiltin: false,
      createdAt: Date.now(),
    });
    const ct = await db.comboTemplates.get("ct1");
    expect(ct?.syncStatus).toBe("pending");
    expect(ct?.spaceId).toBe(testSpace.id);
  });

  it("should record pending deletion for combo template", async () => {
    await createComboTemplate({
      id: "ct2",
      name: "测试模板",
      rules: [{ count: 1 }],
      isBuiltin: false,
      createdAt: Date.now(),
    });
    await deleteComboTemplate("ct2");
    const dels = await db.pendingDeletions.toArray();
    expect(dels.some((d) => d.tableName === "combo_templates" && d.recordId === "ct2")).toBe(true);
  });
});

describe("http-sync-engine", () => {
  let engine: HttpSyncEngine;

  beforeEach(async () => {
    await resetDatabase();
    saveLocalIdentity({ space: testSpace, profile: testProfile });
    engine = new HttpSyncEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockFetchOk(body: unknown) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
  }

  function mockFetchError(status: number, body: string) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: body }),
      text: async () => body,
    } as Response);
  }

  it("should return error when pushing without identity", async () => {
    saveLocalIdentity({ space: { ...testSpace, id: "" }, profile: testProfile });
    // empty space id means no real identity
    // But getLocalIdentity still returns something. Let's clear it properly:
    localStorage.removeItem("hyet_profile_v1");
    localStorage.removeItem("hyet_space_v1");
    const result = await engine.pushChanges();
    expect(result.success).toBe(false);
  });

  it("should push pending menu items successfully", async () => {
    await createMenuItem({
      id: "m4",
      kind: "recipe",
      name: "测试",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockFetchOk({ success: true, count: 1 });
    const result = await engine.pushChanges();
    expect(result.success).toBe(true);
    const item = await db.menuItems.get("m4");
    expect(item?.syncStatus).toBe("synced");
  });

  it("should pull menu items from remote", async () => {
    const remoteItem: MenuItem = {
      id: "remote_1",
      kind: "recipe",
      name: "远程菜",
      tags: ["tag1"],
      weight: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: "other",
      version: 1,
    };
    mockFetchOk([]);
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/menu-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [remoteItem], text: async () => "" } as Response);
      }
      if (url.includes("/tags") || url.includes("/combo-templates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    const result = await engine.pullChanges();
    expect(result.menuItems?.length).toBe(1);
    const local = await db.menuItems.get("remote_1");
    expect(local?.name).toBe("远程菜");
    expect(local?.syncStatus).toBe("synced");
  });

  it("should report zero pending when no changes exist", async () => {
    const status = await engine.getSyncStatus();
    expect(status.pendingCount).toBe(0);
  });

  it("should report correct pending count", async () => {
    await createMenuItem({
      id: "m5",
      kind: "recipe",
      name: "测试",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await createTag({ id: "t3", name: "测试标签", type: "custom", createdAt: Date.now() });
    const status = await engine.getSyncStatus();
    expect(status.pendingCount).toBe(2);
  });

  it("should fetch change logs", async () => {
    mockFetchOk([
      {
        id: "log1",
        spaceId: testSpace.id,
        profileId: testProfile.id,
        tableName: "menu_items",
        recordId: "m1",
        operation: "create",
        version: 1,
        createdAt: Date.now(),
      },
    ]);
    const logs = await engine.fetchChangeLogs(10);
    expect(logs.length).toBe(1);
    expect(logs[0].operation).toBe("create");
  });
});
