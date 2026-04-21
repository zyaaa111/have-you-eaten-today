import path from "path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
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
