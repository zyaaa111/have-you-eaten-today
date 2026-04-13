import { db } from "./db";
import { AppSettings } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  defaultDedupDays: 7,
  dedupEnabled: true,
  theme: "default",
};

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>;
export async function getSetting<T>(key: string, defaultValue: T): Promise<T>;
export async function getSetting<T>(key: string, defaultValue?: T): Promise<T | undefined> {
  const record = await db.settings.get(key);
  if (record && record.value !== undefined) {
    return record.value as T;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  return DEFAULT_SETTINGS[key as keyof AppSettings] as T | undefined;
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void>;
export async function saveSetting<T>(key: string, value: T): Promise<void>;
export async function saveSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getDefaultDedupDays(): Promise<number> {
  const value = await getSetting("defaultDedupDays");
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 365) {
    return DEFAULT_SETTINGS.defaultDedupDays;
  }
  return Math.max(1, Math.min(365, Math.floor(num)));
}

export async function getDedupEnabled(): Promise<boolean> {
  const value = await getSetting("dedupEnabled");
  return typeof value === "boolean" ? value : DEFAULT_SETTINGS.dedupEnabled;
}

export async function getTheme(): Promise<AppSettings["theme"]> {
  const value = await getSetting("theme");
  if (value === "default" || value === "dark" || value === "scrapbook") {
    return value;
  }
  return DEFAULT_SETTINGS.theme;
}
