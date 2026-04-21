import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "npx next dev -p 3100",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      SMTP_HOST: "mock",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "mock@example.com",
      SMTP_PASS: "mock-password",
      AUTH_FROM_EMAIL: "今天吃了吗 <mock@example.com>",
    },
  },
});
