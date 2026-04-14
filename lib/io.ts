import { db, resetDatabase } from "./db";
import { AppExport, MenuItem, PersonalWeight } from "./types";

const CURRENT_SCHEMA_VERSION = "1.0.0";
const CURRENT_APP_VERSION = "1.0.5";

type LegacyMenuItem = MenuItem & {
  weight?: number;
};

type ImportDataShape = Omit<AppExport["data"], "menuItems"> & {
  menuItems: LegacyMenuItem[];
  personalWeights?: PersonalWeight[];
};

type NormalizedImportData = Omit<AppExport["data"], "personalWeights"> & {
  personalWeights: PersonalWeight[];
};

function normalizeImportData(data: ImportDataShape): NormalizedImportData {
  const explicitWeights = Array.isArray(data.personalWeights) ? data.personalWeights : [];
  const explicitWeightIds = new Set(explicitWeights.map((item) => item.menuItemId));
  const synthesizedWeights: PersonalWeight[] = [];

  const menuItems = data.menuItems.map(({ weight, ...item }) => {
    if (!explicitWeightIds.has(item.id) && typeof weight === "number" && weight !== 1) {
      synthesizedWeights.push({ menuItemId: item.id, weight });
    }
    return item;
  });

  return {
    ...data,
    menuItems,
    personalWeights: [...explicitWeights, ...synthesizedWeights],
  };
}

export async function exportData(): Promise<AppExport> {
  const [tags, menuItems, comboTemplates, rollHistory, personalWeights] = await Promise.all([
    db.tags.toArray(),
    db.menuItems.toArray(),
    db.comboTemplates.toArray(),
    db.rollHistory.toArray(),
    db.personalWeights.toArray(),
  ]);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: CURRENT_APP_VERSION,
    data: {
      tags,
      menuItems,
      comboTemplates,
      rollHistory,
      personalWeights,
    },
  };
}

export function downloadExport(data: AppExport) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
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

export async function importData(file: File): Promise<{ success: boolean; error?: string }> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as AppExport & {
      data: ImportDataShape;
    };

    if (!parsed.schemaVersion || !parsed.data) {
      return { success: false, error: "文件格式不正确，缺少必要字段" };
    }

    // 简单结构校验
    if (
      !Array.isArray(parsed.data.tags) ||
      !Array.isArray(parsed.data.menuItems) ||
      !Array.isArray(parsed.data.comboTemplates) ||
      !Array.isArray(parsed.data.rollHistory)
    ) {
      return { success: false, error: "数据表结构不正确" };
    }

    const normalizedData = normalizeImportData(parsed.data);

    // 清空并写入
    await resetDatabase();
    await db.tags.bulkAdd(normalizedData.tags);
    await db.menuItems.bulkAdd(normalizedData.menuItems);
    await db.comboTemplates.bulkAdd(normalizedData.comboTemplates);
    await db.rollHistory.bulkAdd(normalizedData.rollHistory);
    if (normalizedData.personalWeights.length > 0) {
      await db.personalWeights.bulkAdd(normalizedData.personalWeights);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
