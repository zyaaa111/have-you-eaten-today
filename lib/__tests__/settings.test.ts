import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "@/lib/db";
import { getSetting, saveSetting, getDefaultDedupDays, getDedupEnabled, getTheme } from "@/lib/settings";

describe("Settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("should save and retrieve settings", async () => {
    await saveSetting("testKey", "testValue");
    const value = await getSetting("testKey", "default");
    expect(value).toBe("testValue");
  });

  it("should return default value when key does not exist", async () => {
    const value = await getSetting("nonExistentKey", 42);
    expect(value).toBe(42);
  });

  it("should return default dedup days", async () => {
    const days = await getDefaultDedupDays();
    expect(days).toBe(7);
  });

  it("should return fallback for invalid dedup days", async () => {
    await saveSetting("defaultDedupDays", 0);
    expect(await getDefaultDedupDays()).toBe(7);

    await saveSetting("defaultDedupDays", 999);
    expect(await getDefaultDedupDays()).toBe(7);
  });

  it("should update dedup days correctly", async () => {
    await saveSetting("defaultDedupDays", 14);
    expect(await getDefaultDedupDays()).toBe(14);
  });

  it("should return default dedup enabled", async () => {
    expect(await getDedupEnabled()).toBe(true);
  });

  it("should update dedup enabled correctly", async () => {
    await saveSetting("dedupEnabled", false);
    expect(await getDedupEnabled()).toBe(false);
    await saveSetting("dedupEnabled", true);
    expect(await getDedupEnabled()).toBe(true);
  });

  it("should return default theme", async () => {
    expect(await getTheme()).toBe("default");
  });

  it("should update theme correctly", async () => {
    await saveSetting("theme", "dark");
    expect(await getTheme()).toBe("dark");
    await saveSetting("theme", "scrapbook");
    expect(await getTheme()).toBe("scrapbook");
  });

  it("should fallback to default for invalid theme values", async () => {
    await saveSetting("theme", "neon" as any);
    expect(await getTheme()).toBe("default");
  });
});
