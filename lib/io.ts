import { db, resetDatabase } from "./db";
import { AppExport } from "./types";

const CURRENT_SCHEMA_VERSION = "1.0.0";
const CURRENT_APP_VERSION = "0.1.0";

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
    const parsed = JSON.parse(text) as AppExport;

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

    // 清空并写入
    await resetDatabase();
    await db.tags.bulkAdd(parsed.data.tags);
    await db.menuItems.bulkAdd(parsed.data.menuItems);
    await db.comboTemplates.bulkAdd(parsed.data.comboTemplates);
    await db.rollHistory.bulkAdd(parsed.data.rollHistory);
    if (parsed.data.personalWeights && Array.isArray(parsed.data.personalWeights)) {
      await db.personalWeights.bulkAdd(parsed.data.personalWeights);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
