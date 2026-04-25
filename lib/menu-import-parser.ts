import type { MenuItem, Tag, TagType, Ingredient, RecipeStep } from "./types";
import { parseIngredientTextWithErrors } from "./ingredient-parser";
import { loadExcelJS } from "./exceljs-loader";
import { parseKindDisplay, IMPORT_COLUMNS } from "./menu-import-template";

export interface ParsedImportRow {
  rowIndex: number;
  kind: "recipe" | "takeout";
  name: string;
  tagNamesByType: Record<TagType, string[]>;
  weight: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  tips: string;
  shop: string;
  shopAddress: string;
}

export interface ImportSkippedItem {
  row: ParsedImportRow;
  reason: string;
}

export interface ImportError {
  rowIndex: number;
  rawLine: string;
  message: string;
}

export interface ImportPreview {
  toImport: ParsedImportRow[];
  skipped: ImportSkippedItem[];
  errors: ImportError[];
  newTags: Array<{ name: string; type: TagType }>;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const HARD_ROW_LIMIT = 500;
const SOFT_ROW_LIMIT = 100;

function parseTagList(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSteps(text: string): RecipeStep[] {
  if (!text || typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((desc, i) => ({ order: i + 1, description: desc }));
}

function parseWeight(text: string): { weight: number; error?: string } {
  if (!text || typeof text !== "string") return { weight: 1 };
  const trimmed = text.trim();
  if (trimmed === "") return { weight: 1 };
  if (!/^\d+$/.test(trimmed)) {
    return { weight: 1, error: "权重必须是 1-10 的整数" };
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1 || num > 10) {
    return { weight: 1, error: "权重必须在 1-10 之间" };
  }
  return { weight: num };
}

function isRowEmpty(row: Record<string, string>): boolean {
  return Object.values(row).every(
    (v) => !v || (typeof v === "string" && v.trim() === "")
  );
}

function getRawField(raw: Record<string, string>, header: string, key: string): string {
  return raw[header] ?? raw[key] ?? "";
}

export function parseExcelRows(
  rawRows: Record<string, string>[],
  existingMenuItems: MenuItem[],
  existingTags: Tag[]
): ImportPreview {
  const toImport: ParsedImportRow[] = [];
  const skipped: ImportSkippedItem[] = [];
  const errors: ImportError[] = [];
  const newTags: Array<{ name: string; type: TagType }> = [];

  // Build lookup sets
  const existingMenuKeys = new Set(
    existingMenuItems.map((item) => `${item.kind}:${item.name}`)
  );
  const seenFileKeys = new Set<string>();

  // Build tag lookup: lowercase name + type → Tag
  const existingTagMap = new Map<string, Tag>();
  for (const tag of existingTags) {
    existingTagMap.set(`${tag.name.toLowerCase()}:${tag.type}`, tag);
  }

  const newTagSet = new Set<string>();

  const tagColumns: Array<{ header: string; key: string; type: TagType }> = [
    { header: "菜系标签", key: "cuisineTags", type: "cuisine" },
    { header: "类别标签", key: "categoryTags", type: "category" },
    { header: "自定义标签", key: "customTags", type: "custom" },
  ];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];

    // Skip empty rows
    if (isRowEmpty(raw)) continue;

    const rowIndex = i + 2; // 1-based + header row
    const rawLine = `${getRawField(raw, "类型", "kind")} ${getRawField(raw, "名称", "name")}`.trim();

    // Validate kind
    const kindRaw = getRawField(raw, "类型", "kind").trim();
    const kind = parseKindDisplay(kindRaw);
    if (!kind) {
      errors.push({
        rowIndex,
        rawLine,
        message: `类型「${kindRaw || "(空)"}」无效，请填写「菜谱」或「外卖」`,
      });
      continue;
    }

    // Validate name
    const name = getRawField(raw, "名称", "name").trim();
    if (!name) {
      errors.push({
        rowIndex,
        rawLine,
        message: "名称不能为空",
      });
      continue;
    }

    // Validate takeout requires shop
    if (kind === "takeout" && !getRawField(raw, "店铺", "shop").trim()) {
      errors.push({
        rowIndex,
        rawLine,
        message: "外卖类型必须填写店铺",
      });
      continue;
    }

    // Parse weight
    const weightResult = parseWeight(getRawField(raw, "权重", "weight"));
    if (weightResult.error) {
      errors.push({
        rowIndex,
        rawLine,
        message: weightResult.error,
      });
      continue;
    }
    const weight = weightResult.weight;

    // Parse tags
    const tagNamesByType: Record<TagType, string[]> = {
      cuisine: [],
      category: [],
      custom: [],
    };

    for (const { header, key, type } of tagColumns) {
      const tagNames = parseTagList(getRawField(raw, header, key));
      // Deduplicate within same type
      const uniqueNames = Array.from(new Set(tagNames));
      tagNamesByType[type] = uniqueNames;
    }

    // Parse ingredients (reuse ingredient parser)
    const parsedIngredients = parseIngredientTextWithErrors(getRawField(raw, "材料清单", "ingredients"));
    if (parsedIngredients.errors.length > 0) {
      parsedIngredients.errors.forEach((error) => {
        errors.push({
          rowIndex,
          rawLine: error.line,
          message: `材料清单第 ${error.lineNumber} 行：${error.message}`,
        });
      });
      continue;
    }
    const ingredients = parsedIngredients.ingredients;

    // Parse steps
    const steps = parseSteps(getRawField(raw, "步骤", "steps"));

    // Tips
    const tips = getRawField(raw, "心得", "tips").trim();

    // Shop fields
    const shop = kind === "takeout" ? getRawField(raw, "店铺", "shop").trim() : "";
    const shopAddress = kind === "takeout" ? getRawField(raw, "店铺地址", "shopAddress").trim() : "";

    const parsedRow: ParsedImportRow = {
      rowIndex,
      kind,
      name,
      tagNamesByType,
      weight,
      ingredients,
      steps,
      tips,
      shop,
      shopAddress,
    };

    // Deduplicate: file-level
    const fileKey = `${kind}:${name}`;
    if (seenFileKeys.has(fileKey)) {
      skipped.push({
        row: parsedRow,
        reason: `文件内重复：与前面的「${name}」重复`,
      });
      continue;
    }

    // Deduplicate: database-level
    if (existingMenuKeys.has(fileKey)) {
      skipped.push({
        row: parsedRow,
        reason: `数据库已存在「${kind === "recipe" ? "菜谱" : "外卖"}：${name}」`,
      });
      continue;
    }
    seenFileKeys.add(fileKey);

    for (const type of ["cuisine", "category", "custom"] as TagType[]) {
      for (const tagName of tagNamesByType[type]) {
        const lookupKey = `${tagName.toLowerCase()}:${type}`;
        if (!existingTagMap.has(lookupKey) && !newTagSet.has(lookupKey)) {
          newTagSet.add(lookupKey);
          newTags.push({ name: tagName, type });
        }
      }
    }

    toImport.push(parsedRow);
  }

  return { toImport, skipped, errors, newTags };
}

export async function parseImportFile(
  file: File,
  existingMenuItems: MenuItem[],
  existingTags: Tag[]
): Promise<ImportPreview> {
  // File size check
  if (file.size > MAX_FILE_SIZE) {
    return {
      toImport: [],
      skipped: [],
      errors: [
        {
          rowIndex: 0,
          rawLine: file.name,
          message: `文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 5MB 限制`,
        },
      ],
      newTags: [],
    };
  }

  // File type check
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "xlsx") {
    return {
      toImport: [],
      skipped: [],
      errors: [
        {
          rowIndex: 0,
          rawLine: file.name,
          message: `不支持的文件格式「.${ext || ""}」，请上传 .xlsx 文件`,
        },
      ],
      newTags: [],
    };
  }

  const ExcelJS = await loadExcelJS();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  // Find the data sheet
  const dataSheet =
    workbook.getWorksheet("菜单数据") ??
    workbook.worksheets[0];

  if (!dataSheet) {
    return {
      toImport: [],
      skipped: [],
      errors: [{ rowIndex: 0, rawLine: "", message: "未找到数据工作表" }],
      newTags: [],
    };
  }

  // Read header row to build column mapping
  const headerRow = dataSheet.getRow(1);
  const headerMap = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const val = cell.value?.toString()?.trim();
    if (val) headerMap.set(val, colNumber);
  });

  // Map from display header → our key
  const headerToKey = new Map<string, string>();
  for (const col of IMPORT_COLUMNS) {
    headerToKey.set(col.header, col.key);
  }

  // Also support English key headers
  for (const col of IMPORT_COLUMNS) {
    headerToKey.set(col.key, col.key);
  }

  const rawRows: Record<string, string>[] = [];
  const rowCount = dataSheet.rowCount;

  // Hard row limit check
  if (rowCount - 1 > HARD_ROW_LIMIT) {
    return {
      toImport: [],
      skipped: [],
      errors: [
        {
          rowIndex: 0,
          rawLine: "",
          message: `数据行数 ${rowCount - 1} 超过 ${HARD_ROW_LIMIT} 行限制`,
        },
      ],
      newTags: [],
    };
  }

  for (let r = 2; r <= rowCount; r++) {
    const row = dataSheet.getRow(r);
    const record: Record<string, string> = {};

    headerMap.forEach((colNumber, headerName) => {
      const key = headerToKey.get(headerName) ?? headerName;
      const cell = row.getCell(colNumber);
      const value = cell.value?.toString()?.trim() ?? "";
      record[headerName] = value;
      record[key] = value;
    });

    rawRows.push(record);
  }

  const result = parseExcelRows(rawRows, existingMenuItems, existingTags);

  // Soft limit warning
  if (rawRows.filter((r) => !isRowEmpty(r)).length > SOFT_ROW_LIMIT) {
    result.errors.push({
      rowIndex: 0,
      rawLine: "",
      message: `提示：数据行数超过 ${SOFT_ROW_LIMIT} 行，导入可能需要较长时间`,
    });
  }

  return result;
}
