import type { AppSettingRecord, AppSettings } from "./types";

export const SETTINGS_CHANGED_EVENT = "hyet:settings-changed";

export const PROFILE_SYNCED_SETTING_KEYS = [
  "defaultDedupDays",
  "dedupEnabled",
  "theme",
] as const;

export type ProfileSyncedSettingKey = (typeof PROFILE_SYNCED_SETTING_KEYS)[number];

const PROFILE_SYNCED_SETTING_KEY_SET = new Set<string>(PROFILE_SYNCED_SETTING_KEYS);

export function isProfileSyncedSettingKey(key: string): key is ProfileSyncedSettingKey {
  return PROFILE_SYNCED_SETTING_KEY_SET.has(key);
}

export function normalizeProfileSetting(record: AppSettingRecord): AppSettingRecord | null {
  if (!isProfileSyncedSettingKey(record.key)) return null;

  if (record.key === "defaultDedupDays") {
    const value = typeof record.value === "number" ? record.value : Number(record.value);
    if (!Number.isFinite(value)) return null;
    return {
      key: record.key,
      value: Math.max(1, Math.min(365, Math.floor(value))),
      updatedAt: record.updatedAt,
    };
  }

  if (record.key === "dedupEnabled") {
    if (typeof record.value !== "boolean") return null;
    return record;
  }

  if (record.key === "theme") {
    if (!isAppTheme(record.value)) return null;
    return record;
  }

  return null;
}

export function notifySettingsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

function isAppTheme(value: unknown): value is AppSettings["theme"] {
  return value === "default" || value === "dark" || value === "scrapbook";
}
