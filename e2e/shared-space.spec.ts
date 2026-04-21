import path from "path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import {
  createSpace,
  getInviteCodeFromSettings,
  loginWithPassword,
  logoutFromSettings,
  registerWithEmail,
  requestPasswordReset,
  resetPassword,
  seedLegacyLocalIdentity,
} from "./auth-helpers";

function openServerDb() {
  const dbPath = path.resolve(process.cwd(), "server", "data", "menu.db");
  return new Database(dbPath);
}

async function readClientProfileState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("HaveYouEatenTodayDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const getAll = <T,>(storeName: string) =>
      new Promise<T[]>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });

    const [settings, wishes, avoidances, favorites, personalWeights, menuGroups, menuGroupItems] =
      await Promise.all([
        getAll<{ key: string; value: unknown }>("settings"),
        getAll<{ menuItemId: string }>("wishes"),
        getAll<{ menuItemId: string }>("avoidances"),
        getAll<{ menuItemId: string }>("favorites"),
        getAll<{ menuItemId: string; weight: number }>("personalWeights"),
        getAll<{ name: string }>("menuGroups"),
        getAll<{ menuItemId: string }>("menuGroupItems"),
      ]);
    database.close();

    return {
      settings,
      wishes,
      avoidances,
      favorites,
      personalWeights,
      menuGroups,
      menuGroupItems,
    };
  });
}

test.describe.serial("account auth and shared space flows", () => {
  test("can register, create a shared space, and block sync after logout", async ({ page }) => {
    const email = `owner-${Date.now()}@example.com`;
    const password = "Password123";
    await registerWithEmail(page, email, password, "/join");
    await createSpace(page, "小厨神", `测试空间-${Date.now()}`);

    await page.goto("/settings");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("button", { name: "退出空间" })).toBeVisible();

    const inviteCode = await getInviteCodeFromSettings(page);
    expect(inviteCode).toHaveLength(6);

    await logoutFromSettings(page);
    await page.waitForTimeout(300);

    const responseStatus = await page.evaluate(async (spaceId) => {
      const response = await fetch(`/api/sync/menu-items?space_id=${encodeURIComponent(spaceId)}`, {
        credentials: "include",
      });
      return response.status;
    }, await page.evaluate(() => JSON.parse(localStorage.getItem("hyet_space_v1") || "{}").id));
    expect(responseStatus).toBe(401);
  });

  test("supports password reset and subsequent password login", async ({ page }) => {
    const email = `reset-${Date.now()}@example.com`;
    const oldPassword = "Password123";
    const newPassword = "Password456";

    await registerWithEmail(page, email, oldPassword, "/settings");
    await logoutFromSettings(page);
    const resetToken = await requestPasswordReset(page, email);
    await resetPassword(page, email, resetToken, newPassword);
    await loginWithPassword(page, email, newPassword, "/settings");

    await expect(page.getByText(email)).toBeVisible();
  });

  test("restores same-account space data and personal history on a second device", async ({ browser, page }) => {
    const email = `cross-device-${Date.now()}@example.com`;
    const password = "Password123";
    const menuId = `cross-menu-${Date.now()}`;
    const menuName = `跨设备菜-${Date.now()}`;
    const historyId = `cross-history-${Date.now()}`;

    await registerWithEmail(page, email, password, "/join");
    await createSpace(page, "主设备", `跨设备空间-${Date.now()}`);

    await page.evaluate(
      async ({ menuId, menuName, historyId }) => {
        const profile = JSON.parse(window.localStorage.getItem("hyet_profile_v1") || "{}") as { id: string };
        const space = JSON.parse(window.localStorage.getItem("hyet_space_v1") || "{}") as { id: string };
        const now = Date.now();

        const menuResponse = await fetch("/api/sync/menu-items", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([
            {
              id: menuId,
              space_id: space.id,
              profile_id: "forged-profile-should-be-ignored",
              kind: "recipe",
              name: menuName,
              tags: [],
              created_at: now,
              updated_at: now,
              version: 1,
            },
          ]),
        });
        if (!menuResponse.ok) {
          throw new Error(`menu sync failed: ${menuResponse.status}`);
        }

        const profileResponse = await fetch("/api/sync/profile-state", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile_id: profile.id,
            space_id: space.id,
            state: {
              settings: [
                { key: "defaultDedupDays", value: 12, updatedAt: now },
                { key: "dedupEnabled", value: false, updatedAt: now + 1 },
                { key: "theme", value: "dark", updatedAt: now + 2 },
              ],
              avoidances: [{ menuItemId: menuId, scope: "profile", profileId: profile.id, spaceId: space.id, updatedAt: now + 3 }],
              wishes: [{ menuItemId: menuId, scope: "profile", profileId: profile.id, spaceId: space.id, updatedAt: now + 4 }],
              favorites: [{ menuItemId: menuId, scope: "profile", profileId: profile.id, spaceId: space.id, updatedAt: now + 5 }],
              personalWeights: [{ menuItemId: menuId, weight: 4, scope: "profile", profileId: profile.id, spaceId: space.id, updatedAt: now }],
              menuGroups: [],
              menuGroupItems: [],
              rollHistory: [
                {
                  id: historyId,
                  rolledAt: now,
                  items: [{ menuItemId: menuId, name: menuName, kind: "recipe" }],
                  ruleSnapshot: "跨设备历史",
                  ignoredDedup: false,
                },
              ],
            },
          }),
        });
        if (!profileResponse.ok) {
          throw new Error(`profile sync failed: ${profileResponse.status}`);
        }
      },
      { menuId, menuName, historyId }
    );

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await loginWithPassword(secondPage, email, password, "/menu");

    await expect(secondPage.getByText(menuName)).toBeVisible({ timeout: 15_000 });
    const restoredIdentity = await secondPage.evaluate(() => ({
      profile: window.localStorage.getItem("hyet_profile_v1"),
      space: window.localStorage.getItem("hyet_space_v1"),
    }));
    expect(restoredIdentity.profile).toBeTruthy();
    expect(restoredIdentity.space).toBeTruthy();

    await secondPage.goto("/history");
    await expect(secondPage.getByText(menuName)).toBeVisible({ timeout: 15_000 });
    await expect(secondPage.getByText("跨设备历史")).toBeVisible();

    await expect
      .poll(async () => {
        const state = await readClientProfileState(secondPage);
        return {
          dedupDays: state.settings.find((item) => item.key === "defaultDedupDays")?.value,
          dedupEnabled: state.settings.find((item) => item.key === "dedupEnabled")?.value,
          theme: state.settings.find((item) => item.key === "theme")?.value,
          wished: state.wishes.some((item) => item.menuItemId === menuId),
          avoided: state.avoidances.some((item) => item.menuItemId === menuId),
          favorited: state.favorites.some((item) => item.menuItemId === menuId),
          weight: state.personalWeights.find((item) => item.menuItemId === menuId)?.weight,
        };
      }, { timeout: 15_000 })
      .toEqual({
        dedupDays: 12,
        dedupEnabled: false,
        theme: "dark",
        wished: true,
        avoided: true,
        favorited: true,
        weight: 4,
      });
    await expect.poll(() => secondPage.evaluate(() => document.documentElement.getAttribute("data-theme")), { timeout: 15_000 }).toBe("dark");

    const liveGroupName = `在线清单-${Date.now()}`;
    await secondPage.goto("/groups");
    await page.goto("/groups");
    await page.getByPlaceholder("例如：工作日晚餐").fill(liveGroupName);
    await page.locator("aside").getByRole("button").first().click();
    await expect(
      secondPage.locator("aside").getByRole("button", { name: new RegExp(liveGroupName) })
    ).toBeVisible({ timeout: 15_000 });

    await secondContext.close();
  });

  test("can bind the current device's legacy local profile after login", async ({ page }) => {
    const email = `legacy-${Date.now()}@example.com`;
    const password = "Password123";
    const now = Date.now();
    const spaceId = `legacy-space-${now}`;
    const profileId = `legacy-profile-${now}`;
    const inviteCode = `L${String(now).slice(-5)}`;
    const db = openServerDb();

    db.prepare("INSERT INTO spaces (id, invite_code, name, created_at) VALUES (?, ?, ?, ?)").run(
      spaceId,
      inviteCode,
      `旧空间-${now}`,
      now
    );
    db.prepare("INSERT INTO profiles (id, space_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?, ?)").run(
      profileId,
      spaceId,
      "旧成员",
      now
    );
    db.close();

    await seedLegacyLocalIdentity(page, {
      profile: {
        id: profileId,
        spaceId,
        nickname: "旧成员",
        joinedAt: now,
      },
      space: {
        id: spaceId,
        inviteCode,
        name: `旧空间-${now}`,
        createdAt: now,
        updatedAt: now,
      },
    });

    await registerWithEmail(page, email, password, "/settings");
    await expect(page.getByRole("button", { name: "绑定当前设备旧身份" })).toBeVisible();
    await page.getByRole("button", { name: "绑定当前设备旧身份" }).click();
    await expect(page.getByText("当前设备保存的旧空间身份已绑定到这个账号")).toBeVisible();

    const verifyDb = openServerDb();
    const row = verifyDb
      .prepare("SELECT user_id FROM profiles WHERE id = ? LIMIT 1")
      .get(profileId) as { user_id: string | null } | undefined;
    verifyDb.close();
    expect(row?.user_id).toBeTruthy();
  });

  test("supports multi-member aggregated random draw", async ({ browser, page }) => {
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const guestEmail = `guest-${Date.now()}@example.com`;
    const password = "Password123";

    await registerWithEmail(page, ownerEmail, password, "/join");
    await createSpace(page, "房主", `多人抽选空间-${Date.now()}`);
    const inviteCode = await getInviteCodeFromSettings(page);
    const menuName = `多人抽选菜-${Date.now()}`;
    await page.evaluate(async (name) => {
      const space = JSON.parse(window.localStorage.getItem("hyet_space_v1") || "{}") as { id: string };
      const now = Date.now();
      const response = await fetch("/api/sync/menu-items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            id: `multi-member-menu-${now}`,
            space_id: space.id,
            profile_id: "forged-profile-should-be-ignored",
            kind: "recipe",
            name,
            tags: [],
            created_at: now,
            updated_at: now,
            version: 1,
          },
        ]),
      });
      if (!response.ok) {
        throw new Error(`menu sync failed: ${response.status}`);
      }
    }, menuName);

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await registerWithEmail(guestPage, guestEmail, password, "/join");
    await guestPage.goto("/join");
    await guestPage.waitForLoadState("networkidle");
    await guestPage.getByRole("heading", { name: "加入共享菜单" }).waitFor();
    await guestPage.locator("input").nth(0).fill("室友");
    await guestPage.locator("input").nth(1).fill(inviteCode);
    await guestPage.locator("form").getByRole("button", { name: "加入空间" }).click();
    await guestPage.waitForURL("**/menu");

    await page.goto("/random");
    await page.reload();
    await expect(page.getByText("参与成员", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /室友/ }).click();
    await expect(page.getByText("当前展示的是多人聚合推荐结果", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "开始单抽" }).click();
    await expect(page.getByText("抽取结果")).toBeVisible();

    await guestContext.close();
  });
});
