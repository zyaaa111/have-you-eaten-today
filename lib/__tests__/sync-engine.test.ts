import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDatabase, db } from "../db";
import { saveLocalIdentity } from "../identity";
import type { Space, Profile, MenuItem, Like, Comment } from "../types";
import { clearLocalSessionUser, saveLocalSessionUser } from "../auth-client";
import {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createTag,
  deleteTag,
  createComboTemplate,
  deleteComboTemplate,
  enrich,
  detachSpaceData,
  attachLocalDataToSpace,
} from "../space-ops";
import { HttpSyncEngine } from "../http-sync-engine";
import { toggleLike } from "../likes";
import { addComment } from "../comments";
import { buildLikeId } from "../like-id";

const ORIGINAL_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

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

function restoreLoggedInState() {
  saveLocalIdentity({ space: testSpace, profile: testProfile });
  saveLocalSessionUser({
    id: "user_test_1",
    email: "tester@example.com",
    createdAt: Date.now(),
    hasPassword: true,
  });
}

describe("space-ops", () => {
  beforeEach(async () => {
    await resetDatabase();
    restoreLoggedInState();
  });

  it("should create menu item with pending sync status and space info", async () => {
    await createMenuItem({
      id: "m1",
      kind: "recipe",
      name: "红烧肉",
      tags: [],
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

  it("should detach shared data back to local state while clearing shared side effects", async () => {
    await db.menuItems.add({
      id: "shared-menu",
      kind: "recipe",
      name: "共享红烧肉",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: testProfile.id,
      syncStatus: "synced",
      version: 4,
    });
    await db.tags.add({
      id: "shared-tag",
      name: "共享标签",
      type: "custom",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: testProfile.id,
      syncStatus: "synced",
      version: 3,
    });
    await db.comboTemplates.add({
      id: "shared-template",
      name: "共享模板",
      rules: [{ count: 1, kind: "recipe" }],
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: testSpace.id,
      profileId: testProfile.id,
      syncStatus: "synced",
      version: 5,
    });
    await db.likes.add({
      id: buildLikeId(testSpace.id, "shared-menu", testProfile.id),
      menuItemId: "shared-menu",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      createdAt: Date.now(),
      syncStatus: "synced",
    });
    await db.comments.add({
      id: "shared-comment",
      menuItemId: "shared-menu",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      nickname: testProfile.nickname,
      content: "共享评论",
      isAnonymous: false,
      createdAt: Date.now(),
      syncStatus: "synced",
      version: 2,
    });
    await db.pendingDeletions.add({
      tableName: "menu_items",
      recordId: "deleted-menu",
      spaceId: testSpace.id,
      createdAt: Date.now(),
    });
    await db.tagMappings.add({
      spaceId: testSpace.id,
      aliasId: "alias-tag",
      canonicalId: "shared-tag",
    });
    await db.rollHistory.add({
      id: "history-1",
      rolledAt: Date.now(),
      items: [{ menuItemId: "shared-menu", name: "共享红烧肉", kind: "recipe" }],
      ruleSnapshot: "测试历史",
    });
    await db.avoidances.add({ menuItemId: "shared-menu" });
    await db.personalWeights.add({ menuItemId: "shared-menu", weight: 7 });
    await db.settings.put({ key: "theme", value: "default" });

    await detachSpaceData(testSpace.id);

    const menuItem = await db.menuItems.get("shared-menu");
    const tag = await db.tags.get("shared-tag");
    const template = await db.comboTemplates.get("shared-template");

    expect(menuItem).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
    });
    expect(tag).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
    });
    expect(template).toMatchObject({
      spaceId: undefined,
      profileId: undefined,
      syncStatus: "local",
      version: 1,
    });

    expect(await db.likes.count()).toBe(0);
    expect(await db.comments.count()).toBe(0);
    expect(await db.pendingDeletions.count()).toBe(0);
    expect(await db.tagMappings.count()).toBe(0);

    expect(await db.rollHistory.count()).toBe(1);
    expect(await db.avoidances.count()).toBe(1);
    expect(await db.personalWeights.count()).toBe(1);
    expect(await db.settings.get("theme")).toEqual({ key: "theme", value: "default" });
  });

  it("should attach only local core data to a new shared space", async () => {
    await db.menuItems.add({
      id: "local-menu",
      kind: "recipe",
      name: "本地菜单",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "local",
      version: 9,
    });
    await db.tags.add({
      id: "local-tag",
      name: "本地标签",
      type: "custom",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "local",
      version: 8,
    });
    await db.comboTemplates.add({
      id: "local-template",
      name: "本地模板",
      rules: [{ count: 1 }],
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "local",
      version: 7,
    });
    await db.menuItems.add({
      id: "already-shared-menu",
      kind: "recipe",
      name: "已有共享菜单",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      spaceId: "other-space",
      profileId: "other-profile",
      syncStatus: "synced",
      version: 4,
    });

    await attachLocalDataToSpace("space_new", "profile_new");

    expect(await db.menuItems.get("local-menu")).toMatchObject({
      spaceId: "space_new",
      profileId: "profile_new",
      syncStatus: "pending",
      version: 1,
    });
    expect(await db.tags.get("local-tag")).toMatchObject({
      spaceId: "space_new",
      profileId: "profile_new",
      syncStatus: "pending",
      version: 1,
    });
    expect(await db.comboTemplates.get("local-template")).toMatchObject({
      spaceId: "space_new",
      profileId: "profile_new",
      syncStatus: "pending",
      version: 1,
    });
    expect(await db.menuItems.get("already-shared-menu")).toMatchObject({
      spaceId: "other-space",
      profileId: "other-profile",
      syncStatus: "synced",
      version: 4,
    });
  });
});

describe("http-sync-engine", () => {
  let engine: HttpSyncEngine;

  beforeEach(async () => {
    await resetDatabase();
    restoreLoggedInState();
    engine = new HttpSyncEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    clearLocalSessionUser();
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockFetchOk({ success: true, count: 1 });

    await engine.pushChanges();

    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls).toContain("/api/sync/menu-items");
  });

  it("should respect an explicit external API base for sync requests", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://sync.example.com/api/";
    await createMenuItem({
      id: "m4_external_api",
      kind: "recipe",
      name: "外部 API",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockFetchOk({ success: true, count: 1 });

    await engine.pushChanges();

    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls).toContain("https://sync.example.com/api/sync/menu-items");
  });

  it("should pull menu items from remote", async () => {
    const remoteItem: MenuItem = {
      id: "remote_1",
      kind: "recipe",
      name: "远程菜",
      tags: ["tag1"],
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
      if (url.includes("/tags") || url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
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

  it("should discard legacy shared weight when pulling remote menu items", async () => {
    const remoteItem = {
      id: "remote_weight_1",
      kind: "recipe" as const,
      name: "遗留权重菜",
      tags: [],
      weight: 9,
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
      if (url.includes("/tags") || url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    await engine.pullChanges();
    const local = await db.menuItems.get("remote_weight_1") as (MenuItem & { weight?: number }) | undefined;
    expect(local?.weight).toBeUndefined();
    expect(await db.personalWeights.count()).toBe(0);
  });

  it("should sync imageUrl with menu items", async () => {
    const remoteItem: MenuItem = {
      id: "remote_img_1",
      kind: "recipe",
      name: "图片菜",
      tags: [],
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
      if (url.includes("/tags") || url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
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
      if (url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
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
      if (url.includes("/menu-items") || url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
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
      if (url.includes("/combo-templates") || url.includes("/likes") || url.includes("/comments")) {
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

describe("http-sync-engine: likes/comments", () => {
  let engine: HttpSyncEngine;

  beforeEach(async () => {
    await resetDatabase();
    restoreLoggedInState();
    engine = new HttpSyncEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    clearLocalSessionUser();
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setupMockFetch(responses: { urlPattern: string; data: unknown }[]) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      for (const r of responses) {
        if (url.includes(r.urlPattern)) {
          return Promise.resolve({ ok: true, status: 200, json: async () => r.data, text: async () => "" } as Response);
        }
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });
  }

  // Push tests

  it("should push pending likes", async () => {
    await toggleLike("item1");
    mockFetchOk({ success: true, count: 1 });
    const result = await engine.pushChanges();
    expect(result.success).toBe(true);
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const likesCall = fetchCalls.find((c) => c[0].includes("/sync/likes") && !c[0].includes("/delete"));
    expect(likesCall).toBeDefined();
    const localLike = await db.likes.where("menuItemId").equals("item1").first();
    expect(localLike?.syncStatus).toBe("synced");
  });

  it("should push pending comments", async () => {
    await addComment("item1", "好吃！", false);
    mockFetchOk({ success: true, count: 1 });
    const result = await engine.pushChanges();
    expect(result.success).toBe(true);
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const commentsCall = fetchCalls.find((c) => c[0].includes("/sync/comments") && !c[0].includes("/delete"));
    expect(commentsCall).toBeDefined();
    const localComment = await db.comments.where("menuItemId").equals("item1").first();
    expect(localComment?.syncStatus).toBe("synced");
  });

  // Pull merge tests

  it("should pull and merge remote likes (dedup by menuItemId + profileId)", async () => {
    // Local already likes item1
    await toggleLike("item1");
    const localLike = await db.likes.where("menuItemId").equals("item1").first();
    await db.likes.toCollection().modify({ syncStatus: "synced" });

    const remoteLike: Like = {
      id: "remote_like_1",
      menuItemId: "item2",
      profileId: "other_profile",
      spaceId: testSpace.id,
      createdAt: Date.now(),
      syncStatus: "synced",
    };

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [
        // Include the local like in remote to prevent it from being deleted
        { ...localLike, syncStatus: undefined },
        remoteLike,
      ] },
      { urlPattern: "/comments", data: [] },
    ]);

    await engine.pullChanges();
    const allLikes = await db.likes.toArray();
    // Should have both local (item1) and remote (item2)
    expect(allLikes).toHaveLength(2);
    const remote = allLikes.find((l) => l.id === buildLikeId(testSpace.id, "item2", "other_profile"));
    expect(remote).toBeDefined();
    expect(remote?.syncStatus).toBe("synced");
  });

  it("should deduplicate remote like with same menuItemId + profileId", async () => {
    // Local like on item1
    await toggleLike("item1");
    await db.likes.toCollection().modify({ syncStatus: "synced" });
    const localLike = await db.likes.where("menuItemId").equals("item1").first();

    // Remote sends a like with same menuItemId + profileId but different id
    const duplicateLike: Like = {
      id: "remote_dup_like",
      menuItemId: "item1",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      createdAt: Date.now(),
      syncStatus: "synced",
    };

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [duplicateLike] },
      { urlPattern: "/comments", data: [] },
    ]);

    // Remote returns only the duplicate, not the local like,
    // so the local like (same menuItemId+profileId) will be matched by key
    // and not deleted (since remoteLikeKeys contains the same key)

    await engine.pullChanges();
    const allLikes = await db.likes.where("menuItemId").equals("item1").toArray();
    // Should still have only 1 like for item1+profile
    expect(allLikes).toHaveLength(1);
    expect(allLikes[0].id).toBe(localLike!.id);
  });

  it("should pull and merge remote comments (LWW by updatedAt)", async () => {
    // Local comment
    await addComment("item1", "原始评论", false);
    await db.comments.toCollection().modify({ syncStatus: "synced", updatedAt: 1000 });
    const localComment = await db.comments.where("menuItemId").equals("item1").first();

    // Remote sends same id with newer updatedAt
    const updatedComment: Comment = {
      id: localComment!.id,
      menuItemId: "item1",
      profileId: testProfile.id,
      spaceId: testSpace.id,
      nickname: "测试用户",
      content: "修改后的评论",
      isAnonymous: false,
      createdAt: localComment!.createdAt,
      updatedAt: 2000,
      version: 2,
      syncStatus: "synced",
    };

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [] },
      { urlPattern: "/comments", data: [updatedComment] },
    ]);

    await engine.pullChanges();
    const comment = await db.comments.get(localComment!.id);
    expect(comment?.content).toBe("修改后的评论");
    expect(comment?.syncStatus).toBe("synced");
  });

  it("should delete local likes that are not in remote", async () => {
    // Local synced like that was deleted on remote
    const like = enrich<Like>(
      { id: "like_to_delete", menuItemId: "item1", createdAt: Date.now() },
      { syncStatus: "synced" }
    );
    await db.likes.add(like);

    // Remote returns no likes for this space
    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [] },
      { urlPattern: "/comments", data: [] },
    ]);

    await engine.pullChanges();
    const remaining = await db.likes.get("like_to_delete");
    expect(remaining).toBeUndefined();
  });

  it("should NOT delete pending local likes during pull", async () => {
    // Local pending like
    const like = enrich<Like>(
      { id: "like_pending", menuItemId: "item1", createdAt: Date.now() },
      { syncStatus: "pending" }
    );
    await db.likes.add(like);

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [] },
      { urlPattern: "/comments", data: [] },
    ]);

    await engine.pullChanges();
    const remaining = await db.likes.get("like_pending");
    expect(remaining).toBeDefined();
    expect(remaining?.syncStatus).toBe("pending");
  });

  it("should delete local comments that are not in remote", async () => {
    const comment = enrich<Comment>(
      { id: "comment_to_delete", menuItemId: "item1", nickname: "用户", content: "被删评论", isAnonymous: false, createdAt: Date.now() },
      { syncStatus: "synced" }
    );
    await db.comments.add(comment);

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [] },
      { urlPattern: "/comments", data: [] },
    ]);

    await engine.pullChanges();
    const remaining = await db.comments.get("comment_to_delete");
    expect(remaining).toBeUndefined();
  });

  it("should NOT delete pending local comments during pull", async () => {
    const comment = enrich<Comment>(
      { id: "comment_pending", menuItemId: "item1", nickname: "用户", content: "待同步评论", isAnonymous: false, createdAt: Date.now() },
      { syncStatus: "pending" }
    );
    await db.comments.add(comment);

    setupMockFetch([
      { urlPattern: "/menu-items", data: [] },
      { urlPattern: "/tags", data: [] },
      { urlPattern: "/combo-templates", data: [] },
      { urlPattern: "/likes", data: [] },
      { urlPattern: "/comments", data: [] },
    ]);

    await engine.pullChanges();
    const remaining = await db.comments.get("comment_pending");
    expect(remaining).toBeDefined();
  });

  // fetchProfiles tests

  it("should fetch profiles from remote", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const remoteProfiles = [
      { id: "p1", spaceId: testSpace.id, nickname: "Alice", joinedAt: Date.now() },
      { id: "p2", spaceId: testSpace.id, nickname: "Bob", joinedAt: Date.now() },
    ];
    mockFetchOk(remoteProfiles);

    const profiles = await engine.fetchProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0].nickname).toBe("Alice");
  });

  it("should return empty array when no space identity for fetchProfiles", async () => {
    localStorage.removeItem("hyet_profile_v1");
    localStorage.removeItem("hyet_space_v1");
    const profiles = await engine.fetchProfiles();
    expect(profiles).toHaveLength(0);
  });

  it("should cache profiles within TTL", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const remoteProfiles = [
      { id: "p1", spaceId: testSpace.id, nickname: "Alice", joinedAt: Date.now() },
    ];
    mockFetchOk(remoteProfiles);

    await engine.fetchProfiles();
    await engine.fetchProfiles();

    // fetch should only be called once due to cache
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0].includes("/sync/profiles")
    );
    expect(fetchCalls).toHaveLength(1);
  });

  // Pending count tests

  it("should count pending likes in sync status", async () => {
    await toggleLike("item1");
    const status = await engine.getSyncStatus();
    expect(status.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it("should count pending comments in sync status", async () => {
    await addComment("item1", "测试评论", false);
    const status = await engine.getSyncStatus();
    expect(status.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it("should clear deterministic like deletions when remote already has no row", async () => {
    const likeId = buildLikeId(testSpace.id, "item1", testProfile.id);
    await db.pendingDeletions.add({
      tableName: "likes",
      recordId: likeId,
      spaceId: testSpace.id,
      createdAt: Date.now(),
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/sync/likes/delete")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, deleted: 0, deletedIds: [], missingIds: [likeId] }),
          text: async () => "",
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    });

    const result = await engine.pushChanges();
    expect(result.success).toBe(true);
    const pending = await db.pendingDeletions.where({ tableName: "likes", recordId: likeId }).count();
    expect(pending).toBe(0);
  });
});

describe("http-sync-engine: syncChanges", () => {
  let engine: HttpSyncEngine;

  beforeEach(async () => {
    await resetDatabase();
    restoreLoggedInState();
    engine = new HttpSyncEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    clearLocalSessionUser();
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should call pushChanges then pullChanges on syncChanges", async () => {
    const callOrder: string[] = [];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      // POST = push, GET = pull
      callOrder.push(`${method}:${url}`);

      if (method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, deletedIds: [], missingIds: [] }), text: async () => "" } as Response);
      }
      // Pull endpoints return arrays
      return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "" } as Response);
    });

    const result = await engine.syncChanges();
    expect(result.success).toBe(true);

    // Find the first GET (pull) call
    const firstGetIndex = callOrder.findIndex((c) => c.startsWith("GET:"));
    expect(firstGetIndex).toBeGreaterThanOrEqual(0);

    // All POST (push) calls must come before the first GET (pull) call
    for (let i = 0; i < firstGetIndex; i++) {
      expect(callOrder[i].startsWith("POST:")).toBe(true);
    }

    // GET calls should exist (5 pull endpoints)
    const getCalls = callOrder.filter((c) => c.startsWith("GET:"));
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should return early with error when pushChanges fails", async () => {
    await createMenuItem({
      id: "m_fail",
      kind: "recipe",
      name: "失败测试",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    mockFetchError(500, "Server error");

    const result = await engine.syncChanges();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("http-sync-engine: subscribeToChanges", () => {
  let engine: HttpSyncEngine;

  beforeEach(async () => {
    await resetDatabase();
    restoreLoggedInState();
    engine = new HttpSyncEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    clearLocalSessionUser();
    vi.useRealTimers();
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should call callback periodically", async () => {
    vi.useFakeTimers();
    const callback = vi.fn().mockResolvedValue(undefined);
    const sub = engine.subscribeToChanges(callback);

    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(2);

    sub.unsubscribe();
  });

  it("should apply exponential backoff on callback error", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const callback = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) throw new Error("fail");
    });
    const sub = engine.subscribeToChanges(callback);

    // First call at 3s - will fail
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(1);

    // Backoff: next call at 6s
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callback).toHaveBeenCalledTimes(2);

    // After success, back to 3s
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(3);

    sub.unsubscribe();
  });

  it("should cap backoff at 30 seconds", async () => {
    vi.useFakeTimers();
    const callback = vi.fn().mockRejectedValue(new Error("always fail"));
    const sub = engine.subscribeToChanges(callback);

    // 3s → 6s → 12s → 24s → 30s (capped)
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(6000);
    await vi.advanceTimersByTimeAsync(12000);
    await vi.advanceTimersByTimeAsync(24000);
    await vi.advanceTimersByTimeAsync(30000);
    expect(callback).toHaveBeenCalledTimes(5);

    // Should still be 30s
    await vi.advanceTimersByTimeAsync(30000);
    expect(callback).toHaveBeenCalledTimes(6);

    sub.unsubscribe();
  });

  it("should stop polling after unsubscribe", async () => {
    vi.useFakeTimers();
    const callback = vi.fn().mockResolvedValue(undefined);
    const sub = engine.subscribeToChanges(callback);

    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(1);

    sub.unsubscribe();

    await vi.advanceTimersByTimeAsync(30000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("should wait for an async callback to finish before scheduling the next tick", async () => {
    vi.useFakeTimers();
    const firstRun = createDeferred<void>();
    const secondRun = createDeferred<void>();
    const callback = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRun.promise)
      .mockImplementationOnce(() => secondRun.promise);
    const sub = engine.subscribeToChanges(callback);

    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(callback).toHaveBeenCalledTimes(1);

    firstRun.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(2);

    secondRun.resolve();
    await Promise.resolve();
    sub.unsubscribe();
  });

  it("should not reschedule after unsubscribe while a callback is still running", async () => {
    vi.useFakeTimers();
    const pendingCallback = createDeferred<void>();
    const callback = vi.fn<() => Promise<void>>().mockImplementation(() => pendingCallback.promise);
    const sub = engine.subscribeToChanges(callback);

    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(1);

    sub.unsubscribe();
    pendingCallback.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30000);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("should return an object with unsubscribe method", () => {
    const sub = engine.subscribeToChanges(async () => {});
    expect(sub).toHaveProperty("unsubscribe");
    expect(typeof sub.unsubscribe).toBe("function");
    sub.unsubscribe();
  });
});
