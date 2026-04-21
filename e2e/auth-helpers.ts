import type { Page } from "@playwright/test";

export async function registerWithEmail(page: Page, email: string, password: string, redirectTo = "/settings") {
  await page.goto(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("至少 8 位，包含字母和数字").first().fill(password);
  await page.getByPlaceholder("再次输入密码").fill(password);
  await page.getByRole("button", { name: "注册并继续" }).click();
  await page.waitForURL(`**${redirectTo}`);
  await page.waitForLoadState("domcontentloaded");
}

export async function loginWithPassword(page: Page, email: string, password: string, redirectTo = "/settings") {
  await page.goto(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("至少 8 位，包含字母和数字").first().fill(password);
  await page.getByRole("button", { name: "登录并继续" }).click();
  await page.waitForURL(`**${redirectTo}`);
  await page.waitForLoadState("domcontentloaded");
}

export async function requestPasswordReset(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "忘记密码" }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/auth/password-reset/request") && response.ok()
  );
  await page.getByRole("button", { name: "发送设置/重置密码邮件" }).click();
  const response = await responsePromise;
  const body = (await response.json()) as { debugResetToken?: string };
  if (!body.debugResetToken) {
    throw new Error("Missing debug reset token in non-production environment");
  }
  return body.debugResetToken;
}

export async function resetPassword(page: Page, email: string, token: string, newPassword: string) {
  await page.goto(`/login?mode=reset&email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator('input[type="password"]').nth(0).fill(newPassword);
  await page.locator('input[type="password"]').nth(1).fill(newPassword);
  await page.getByRole("button", { name: "确认设置新密码" }).click();
  await page.getByText("密码已重置，请使用新密码登录").waitFor();
}

export async function createSpace(page: Page, nickname: string, spaceName: string) {
  await page.goto("/join");
  await page.getByRole("heading", { name: "加入共享菜单" }).waitFor();
  const spaceNameInput = page.getByPlaceholder("如：咱们宿舍的菜单");
  for (let attempt = 0; attempt < 3 && !(await spaceNameInput.isVisible().catch(() => false)); attempt++) {
    await page.getByRole("button", { name: "创建空间" }).first().click();
    await spaceNameInput.waitFor({ state: "visible", timeout: 1000 }).catch(() => undefined);
  }
  await page.getByPlaceholder("如：小厨神").fill(nickname);
  await spaceNameInput.fill(spaceName);
  await page.locator("form").getByRole("button", { name: "创建空间" }).click();
  await page.waitForURL("**/menu");
}

export async function getInviteCodeFromSettings(page: Page) {
  await page.goto("/settings");
  const spaceSection = page.getByRole("heading", { name: "共享空间" });
  await spaceSection.waitFor();
  const inviteCode = await page.locator("text=邀请码").locator("..").locator(".font-mono").innerText();
  return inviteCode.trim();
}

export async function logoutFromSettings(page: Page) {
  await page.goto("/settings");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/logout") && response.ok()),
    page.getByRole("button", { name: "退出登录" }).click(),
  ]);
  await page.getByRole("button", { name: "登录账号" }).waitFor();
}

export async function seedLegacyLocalIdentity(page: Page, payload: {
  profile: { id: string; spaceId: string; nickname: string; joinedAt: number };
  space: { id: string; inviteCode: string; name: string; createdAt: number; updatedAt: number };
}) {
  await page.addInitScript((identity) => {
    window.localStorage.setItem("hyet_profile_v1", JSON.stringify(identity.profile));
    window.localStorage.setItem("hyet_space_v1", JSON.stringify(identity.space));
  }, payload);
}
