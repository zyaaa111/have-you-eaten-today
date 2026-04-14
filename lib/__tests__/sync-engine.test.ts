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

const ORIGINAL_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

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
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
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

  it("should default sync requests to /api when NEXT_PUBLIC_API_BASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    await createMenuItem({
      id: "m4_default_api",
      kind: "recipe",
      name: "默认 API",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockFetchOk({ success: true, count: 1 });

    await engine.pushChanges();

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("/api/sync/menu-items");
  });

  it("should respect an explicit external API base for sync requests", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://sync.example.com/api/";
    await createMenuItem({
      id: "m4_external_api",
      kind: "recipe",
      name: "外部 API",
      tags: [],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockFetchOk({ success: true, count: 1 });

    await engine.pushChanges();

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "https://sync.example.com/api/sync/menu-items"
    );
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
    expect(local?.tags).toEqual(["tag1"]);
  });

  it("should sync imageUrl with menu items", async () => {
    const remoteItem: MenuItem = {
      id: "remote_img_1",
      kind: "recipe",
      name: "图片菜",
      tags: [],
      weight: 1,
      imageUrl: "data:image/jpeg;base64,/9j/4AAQ...",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: "other",
      version: 1,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/menu-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [remoteItem], text: async () => "" } as Response);
      }
      if (url.includes("/tags") || url.includes("/combo-templates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    await engine.pullChanges();
    const local = await db.menuItems.get("remote_img_1");
    expect(local?.imageUrl).toBe("data:image/jpeg;base64,/9j/4AAQ...");
  });

  it("should merge tags from different devices for the same menu item", async () => {
    // Local device already has the menu item with a local tag
    await createTag({ id: "local_tag_1", name: "辣", type: "custom", createdAt: Date.now() });
    await createMenuItem({
      id: "shared_m1",
      kind: "recipe",
      name: "鱼香肉丝",
      tags: ["local_tag_1"],
      weight: 1,
      createdAt: Date.now(),
      updatedAt: 1000,
    });
    // Mark local as synced
    await db.menuItems.update("shared_m1", { syncStatus: "synced" });

    const remoteItem: MenuItem = {
      id: "shared_m1",
      kind: "recipe",
      name: "鱼香肉丝",
      tags: ["remote_tag_1"], // remote device added a different tag
      weight: 1,
      createdAt: Date.now(),
      updatedAt: 2000, // newer
      spaceId: testSpace.id,
      profileId: "other",
      version: 2,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/menu-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [remoteItem], text: async () => "" } as Response);
      }
      if (url.includes("/tags")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => [{ id: "remote_tag_1", name: "川菜", type: "cuisine", createdAt: Date.now(), spaceId: testSpace.id, profileId: "other", version: 1 }],
          text: async () => "",
        } as Response);
      }
      if (url.includes("/combo-templates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    await engine.pullChanges();
    const local = await db.menuItems.get("shared_m1");
    expect(local?.tags).toContain("local_tag_1");
    expect(local?.tags).toContain("remote_tag_1");
  });

  it("should deduplicate remote tags with same name and map ids", async () => {
    // Local already has a "川菜" tag
    await createTag({ id: "local_sichuan", name: "川菜", type: "cuisine", createdAt: Date.now() });
    await db.tags.update("local_sichuan", { syncStatus: "synced" });

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/tags")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => [
            { id: "remote_sichuan", name: "川菜", type: "cuisine", createdAt: Date.now(), spaceId: testSpace.id, profileId: "other", version: 1 },
          ],
          text: async () => "",
        } as Response);
      }
      if (url.includes("/menu-items") || url.includes("/combo-templates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    await engine.pullChanges();
    const tags = await db.tags.toArray();
    const sichuanTags = tags.filter((t) => t.name === "川菜" && t.type === "cuisine");
    expect(sichuanTags.length).toBe(1);
    expect(sichuanTags[0].id).toBe("local_sichuan");

    const mappings = await db.tagMappings.where({ spaceId: testSpace.id }).toArray();
    expect(mappings.length).toBe(1);
    expect(mappings[0].aliasId).toBe("remote_sichuan");
    expect(mappings[0].canonicalId).toBe("local_sichuan");
  });

  it("should replace aliased tag ids in remote menu items", async () => {
    // Local already has "川菜"
    await createTag({ id: "local_sichuan", name: "川菜", type: "cuisine", createdAt: Date.now() });
    await db.tags.update("local_sichuan", { syncStatus: "synced" });

    const remoteItem: MenuItem = {
      id: "remote_dish",
      kind: "recipe",
      name: "宫保鸡丁",
      tags: ["remote_sichuan"], // uses the remote alias id
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: "other",
      version: 1,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/menu-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [remoteItem], text: async () => "" } as Response);
      }
      if (url.includes("/tags")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => [
            { id: "remote_sichuan", name: "川菜", type: "cuisine", createdAt: Date.now(), spaceId: testSpace.id, profileId: "other", version: 1 },
          ],
          text: async () => "",
        } as Response);
      }
      if (url.includes("/combo-templates")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    await engine.pullChanges();
    const local = await db.menuItems.get("remote_dish");
    expect(local?.tags).not.toContain("remote_sichuan");
    expect(local?.tags).toContain("local_sichuan");
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
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
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
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      `/api/changelog?space_id=${encodeURIComponent(testSpace.id)}&limit=10`
    );
  });
});
