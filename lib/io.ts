import JSZip from "jszip";
import { db, resetDatabase } from "./db";
import { getLocalIdentity } from "./identity";
import {
  AppExport,
  AppSettingRecord,
  AvoidanceRecord,
  ComboTemplate,
  FavoriteRecord,
  MenuItem,
  MenuGroup,
  MenuGroupItem,
  PersonalWeight,
  Tag,
  WishRecord,
} from "./types";
import { fetchImageBlob, uploadMenuItemImage, uploadMenuItemImageFromDataUrl } from "./menu-item-images";
import { isDataUrlImage } from "./image-utils";
import { splitLocalPrivateState } from "./private-scope";

const CURRENT_SCHEMA_VERSION = "1.1.0";
const CURRENT_APP_VERSION = "1.1.0";

type LegacyMenuItem = MenuItem & {
  weight?: number;
};

type ImportDataShape = Omit<
  AppExport["data"],
  "menuItems" | "settings" | "avoidances" | "personalWeights" | "wishes" | "favorites" | "menuGroups" | "menuGroupItems"
> & {
  menuItems: LegacyMenuItem[];
  settings?: AppSettingRecord[];
  avoidances?: AvoidanceRecord[];
  wishes?: WishRecord[];
  favorites?: FavoriteRecord[];
  personalWeights?: PersonalWeight[];
  menuGroups?: MenuGroup[];
  menuGroupItems?: MenuGroupItem[];
  imageFiles?: Record<string, string>;
};

type NormalizedImportData = AppExport["data"];

function localizeMenuItem(item: MenuItem): MenuItem {
  return {
    ...item,
    spaceId: undefined,
    profileId: undefined,
    syncStatus: "local",
    version: 1,
  };
}

function localizeTag(tag: Tag): Tag {
  return {
    ...tag,
    spaceId: undefined,
    profileId: undefined,
    syncStatus: "local",
    version: 1,
  };
}

function localizeComboTemplate(template: ComboTemplate): ComboTemplate {
  return {
    ...template,
    spaceId: undefined,
    profileId: undefined,
    syncStatus: "local",
    version: 1,
  };
}

function filterRuleTagIds(tagIds: string[] | undefined, allowedTagIds: Set<string>): string[] | undefined {
  if (!tagIds) {
    return undefined;
  }
  return tagIds.filter((tagId) => allowedTagIds.has(tagId));
}

function normalizeImportData(data: ImportDataShape): NormalizedImportData {
  const settings = Array.isArray(data.settings) ? data.settings.map(({ key, value }) => ({ key, value })) : [];
  const explicitWeights = Array.isArray(data.personalWeights) ? data.personalWeights : [];
  const explicitWeightIds = new Set(explicitWeights.map((item) => item.menuItemId));
  const synthesizedWeights: PersonalWeight[] = [];

  const tags = data.tags.map(localizeTag);
  const localTagIds = new Set(tags.map((tag) => tag.id));
  const menuItems = data.menuItems.map(({ weight, ...item }) => {
    if (!explicitWeightIds.has(item.id) && typeof weight === "number" && weight !== 1) {
      synthesizedWeights.push({ menuItemId: item.id, weight });
    }
    return localizeMenuItem({
      ...item,
      tags: item.tags.filter((tagId) => localTagIds.has(tagId)),
    });
  });
  const menuItemIds = new Set(menuItems.map((item) => item.id));
  const comboTemplates = data.comboTemplates.map((template) =>
    localizeComboTemplate({
      ...template,
      rules: template.rules.map((rule) => ({
        ...rule,
        tagIds: filterRuleTagIds(rule.tagIds, localTagIds),
      })),
    })
  );
  const avoidances = Array.isArray(data.avoidances)
    ? data.avoidances
        .filter((item) => menuItemIds.has(item.menuItemId))
        .map(({ menuItemId }) => ({ menuItemId }))
    : [];

  return {
    settings,
    avoidances,
    wishes: Array.isArray(data.wishes)
      ? splitLocalPrivateState(
          data.wishes
            .filter((item) => menuItemIds.has(item.menuItemId))
            .map(({ menuItemId, updatedAt }) => ({ menuItemId, scope: "local", updatedAt: updatedAt ?? Date.now() }))
        )
      : [],
    favorites: Array.isArray(data.favorites)
      ? splitLocalPrivateState(
          data.favorites
            .filter((item) => menuItemIds.has(item.menuItemId))
            .map(({ menuItemId, updatedAt }) => ({ menuItemId, scope: "local", updatedAt: updatedAt ?? Date.now() }))
        )
      : [],
    tags,
    menuItems,
    comboTemplates,
    rollHistory: data.rollHistory,
    personalWeights: [...explicitWeights, ...synthesizedWeights]
      .filter((item) => menuItemIds.has(item.menuItemId))
      .map(({ menuItemId, weight, updatedAt }) => ({ menuItemId, weight, scope: "local", updatedAt: updatedAt ?? Date.now() })),
    menuGroups: Array.isArray(data.menuGroups)
      ? data.menuGroups
          .filter((group) => (group.scope ?? "local") === "local")
          .map((group) => ({
            ...group,
            scope: "local",
            profileId: undefined,
            spaceId: undefined,
          }))
      : [],
    menuGroupItems: Array.isArray(data.menuGroupItems)
      ? data.menuGroupItems
          .filter((item) => menuItemIds.has(item.menuItemId))
          .map((item) => ({
            ...item,
            profileId: undefined,
            spaceId: undefined,
          }))
      : [],
  };
}

export async function exportData(): Promise<AppExport> {
  const [settings, avoidances, wishes, favorites, allTags, allMenuItems, allComboTemplates, rollHistory, allPersonalWeights, allMenuGroups, allMenuGroupItems] =
    await Promise.all([
      db.settings.toArray(),
      db.avoidances.toArray(),
      db.wishes.toArray(),
      db.favorites.toArray(),
      db.tags.toArray(),
      db.menuItems.toArray(),
      db.comboTemplates.toArray(),
      db.rollHistory.toArray(),
      db.personalWeights.toArray(),
      db.menuGroups.toArray(),
      db.menuGroupItems.toArray(),
    ]);
  const filteredSettings = settings.filter((record) => !["favoriteIds", "wishIds"].includes(record.key));
  const tags = allTags.filter((tag) => !tag.spaceId);
  const localTagIds = new Set(tags.map((tag) => tag.id));
  const menuItems = allMenuItems
    .filter((item) => !item.spaceId)
    .map((item) => ({
      ...item,
      tags: item.tags.filter((tagId) => localTagIds.has(tagId)),
    }));
  const menuItemIds = new Set(menuItems.map((item) => item.id));
  const comboTemplates = allComboTemplates
    .filter((template) => !template.spaceId)
    .map((template) => ({
      ...template,
      rules: template.rules.map((rule) => ({
        ...rule,
        tagIds: filterRuleTagIds(rule.tagIds, localTagIds),
      })),
    }));
  const personalWeights = allPersonalWeights
    .filter((item) => menuItemIds.has(item.menuItemId))
    .map(({ menuItemId, weight }) => ({ menuItemId, weight }));
  const localAvoidances = avoidances
    .filter((item) => (item.scope ?? "local") === "local" && menuItemIds.has(item.menuItemId))
    .map(({ menuItemId }) => ({ menuItemId }));
  const localWishes = wishes
    .filter((item) => (item.scope ?? "local") === "local" && menuItemIds.has(item.menuItemId))
    .map(({ menuItemId, updatedAt }) => ({ menuItemId, scope: "local" as const, updatedAt }));
  const localFavorites = favorites
    .filter((item) => (item.scope ?? "local") === "local" && menuItemIds.has(item.menuItemId))
    .map(({ menuItemId, updatedAt }) => ({ menuItemId, scope: "local" as const, updatedAt }));
  const localMenuGroups = allMenuGroups
    .filter((group) => group.scope === "local")
    .map((group) => ({
      ...group,
      profileId: undefined,
      spaceId: undefined,
    }));
  const localGroupIds = new Set(localMenuGroups.map((group) => group.id));
  const localMenuGroupItems = allMenuGroupItems
    .filter((item) => localGroupIds.has(item.groupId) && menuItemIds.has(item.menuItemId))
    .map((item) => ({
      ...item,
      profileId: undefined,
      spaceId: undefined,
    }));
  const imageFiles = Object.fromEntries(
    menuItems
      .filter((item) => !!item.imageUrl)
      .map((item) => [item.id, `images/${item.id}`])
  );

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: CURRENT_APP_VERSION,
    data: {
      settings: filteredSettings,
      avoidances: localAvoidances,
      wishes: localWishes,
      favorites: localFavorites,
      tags,
      menuItems,
      comboTemplates,
      rollHistory,
      personalWeights,
      menuGroups: localMenuGroups,
      menuGroupItems: localMenuGroupItems,
      imageFiles,
    },
  };
}

export function downloadExport(data: AppExport) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `have-you-eaten-today-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function computeChecksum(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function exportWithChecksum(): Promise<AppExport & { checksum: string }> {
  const data = await exportData();
  const payload = JSON.stringify(data.data);
  const checksum = await computeChecksum(payload);
  return { ...data, checksum };
}

export async function exportBackupArchive(): Promise<Blob> {
  const data = await exportWithChecksum();
  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(data, null, 2));

  const imageEntries = data.data.menuItems.filter((item) => item.imageUrl && data.data.imageFiles?.[item.id]);
  for (const item of imageEntries) {
    const zipPath = data.data.imageFiles?.[item.id];
    if (!zipPath || !item.imageUrl) continue;
    const blob = await fetchImageBlob(item.imageUrl);
    zip.file(zipPath, blob);
  }

  return zip.generateAsync({ type: "blob" });
}

export function downloadExportWithChecksum(data: AppExport & { checksum: string }) {
  downloadExport(data);
}

export function downloadBackupArchive(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `have-you-eaten-today-backup-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function parseImportSource(file: File): Promise<{
  parsed: AppExport & { data: ImportDataShape; checksum?: string };
  archivedImages: Map<string, Blob>;
}> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const backupFile = zip.file("backup.json");
    if (!backupFile) {
      throw new Error("ZIP 备份中缺少 backup.json");
    }
    const parsed = JSON.parse(await backupFile.async("text")) as AppExport & {
      data: ImportDataShape;
      checksum?: string;
    };
    const archivedImages = new Map<string, Blob>();
    await Promise.all(
      Object.values(parsed.data.imageFiles ?? {}).map(async (zipPath) => {
        const entry = zip.file(zipPath);
        if (!entry) return;
        archivedImages.set(zipPath, await entry.async("blob"));
      })
    );
    return { parsed, archivedImages };
  }

  const parsed = JSON.parse(await file.text()) as AppExport & {
    data: ImportDataShape;
    checksum?: string;
  };
  return { parsed, archivedImages: new Map<string, Blob>() };
}

async function restoreImportedImages(
  menuItems: MenuItem[],
  imageFiles: Record<string, string> | undefined,
  archivedImages: Map<string, Blob>
): Promise<MenuItem[]> {
  const restoredItems: MenuItem[] = [];
  for (const item of menuItems) {
    let imageUrl = item.imageUrl;
    const archivePath = imageFiles?.[item.id];

    try {
      if (archivePath && archivedImages.has(archivePath)) {
        imageUrl = await uploadMenuItemImage(item.id, archivedImages.get(archivePath)!);
      } else if (imageUrl && isDataUrlImage(imageUrl)) {
        imageUrl = await uploadMenuItemImageFromDataUrl(item.id, imageUrl);
      }
    } catch {
      // Legacy JSON import should still succeed even if the local image API is unavailable.
    }

    restoredItems.push({
      ...item,
      imageUrl,
    });
  }
  return restoredItems;
}

export async function importData(file: File): Promise<{ success: boolean; error?: string }> {
  if (getLocalIdentity()) {
    return { success: false, error: "当前仍在共享空间中，请先退出空间后再导入个人备份" };
  }

  try {
    const { parsed, archivedImages } = await parseImportSource(file);

    if (!parsed.schemaVersion || !parsed.data) {
      return { success: false, error: "文件格式不正确，缺少必要字段" };
    }

    if (parsed.checksum) {
      const payload = JSON.stringify(parsed.data);
      const expectedChecksum = await computeChecksum(payload);
      if (expectedChecksum !== parsed.checksum) {
        return { success: false, error: "数据校验失败，备份文件可能已损坏" };
      }
    }

    if (
      !Array.isArray(parsed.data.tags) ||
      !Array.isArray(parsed.data.menuItems) ||
      !Array.isArray(parsed.data.comboTemplates) ||
      !Array.isArray(parsed.data.rollHistory)
    ) {
      return { success: false, error: "数据表结构不正确" };
    }

    const normalizedData = normalizeImportData(parsed.data);
    const restoredMenuItems = await restoreImportedImages(
      normalizedData.menuItems,
      parsed.data.imageFiles,
      archivedImages
    );

    await resetDatabase();
    await db.transaction(
      "rw",
      [
        db.settings,
        db.avoidances,
        db.wishes,
        db.favorites,
        db.tags,
        db.menuItems,
        db.comboTemplates,
        db.rollHistory,
        db.personalWeights,
        db.menuGroups,
        db.menuGroupItems,
      ],
      async () => {
        if (normalizedData.settings.length > 0) {
          await db.settings.bulkPut(normalizedData.settings);
        }
        if (normalizedData.avoidances.length > 0) {
          await db.avoidances.bulkAdd(normalizedData.avoidances);
        }
        if ((normalizedData.wishes?.length ?? 0) > 0) {
          await db.wishes.bulkAdd(normalizedData.wishes ?? []);
        }
        if ((normalizedData.favorites?.length ?? 0) > 0) {
          await db.favorites.bulkAdd(normalizedData.favorites ?? []);
        }
        if (normalizedData.tags.length > 0) {
          await db.tags.bulkAdd(normalizedData.tags);
        }
        if (restoredMenuItems.length > 0) {
          await db.menuItems.bulkAdd(restoredMenuItems);
        }
        if (normalizedData.comboTemplates.length > 0) {
          await db.comboTemplates.bulkAdd(normalizedData.comboTemplates);
        }
        if (normalizedData.rollHistory.length > 0) {
          await db.rollHistory.bulkAdd(normalizedData.rollHistory);
        }
        if (normalizedData.personalWeights.length > 0) {
          await db.personalWeights.bulkAdd(normalizedData.personalWeights);
        }
        if ((normalizedData.menuGroups?.length ?? 0) > 0) {
          await db.menuGroups.bulkAdd(normalizedData.menuGroups ?? []);
        }
        if ((normalizedData.menuGroupItems?.length ?? 0) > 0) {
          await db.menuGroupItems.bulkAdd(normalizedData.menuGroupItems ?? []);
        }
      }
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
