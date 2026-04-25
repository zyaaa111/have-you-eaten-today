import type { MenuItemKind } from "./types";
import { loadExcelJS } from "./exceljs-loader";

export interface ImportColumnDef {
  key: string;
  header: string;
  required: boolean;
  width: number;
  description: string;
}

export const VALID_KINDS = ["菜谱", "外卖"] as const;

const KIND_MAP: Record<string, MenuItemKind | null> = {
  菜谱: "recipe",
  食谱: "recipe",
  recipe: "recipe",
  外卖: "takeout",
  takeout: "takeout",
};

export function parseKindDisplay(text: string): MenuItemKind | null {
  const trimmed = text.trim();
  return KIND_MAP[trimmed] ?? null;
}

export const IMPORT_COLUMNS: readonly ImportColumnDef[] = [
  { key: "kind", header: "类型", required: true, width: 10, description: "菜谱 或 外卖" },
  { key: "name", header: "名称", required: true, width: 20, description: "菜品名称" },
  { key: "cuisineTags", header: "菜系标签", required: false, width: 15, description: "中英文逗号分隔，如：中餐,川菜" },
  { key: "categoryTags", header: "类别标签", required: false, width: 15, description: "中英文逗号分隔，如：主食,汤" },
  { key: "customTags", header: "自定义标签", required: false, width: 15, description: "中英文逗号分隔，如：快手菜" },
  { key: "weight", header: "权重", required: false, width: 8, description: "1-10 的整数，默认 1" },
  { key: "ingredients", header: "材料清单", required: false, width: 30, description: "每行一种材料，格式：名称|数量|单位" },
  { key: "steps", header: "步骤", required: false, width: 30, description: "每行一个步骤" },
  { key: "tips", header: "心得", required: false, width: 25, description: "烹饪心得或备注" },
  { key: "shop", header: "店铺", required: false, width: 20, description: "外卖店铺名称（外卖必填）" },
  { key: "shopAddress", header: "店铺地址", required: false, width: 25, description: "外卖店铺地址" },
] as const;

export async function generateImportTemplate(): Promise<Blob> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Instructions
  const instrSheet = workbook.addWorksheet("填写说明");
  instrSheet.columns = [
    { header: "列名", key: "col", width: 14 },
    { header: "是否必填", key: "req", width: 10 },
    { header: "说明", key: "desc", width: 40 },
    { header: "示例", key: "example", width: 30 },
  ];

  // Header row styling
  const instrHeader = instrSheet.getRow(1);
  instrHeader.font = { bold: true };
  for (const col of IMPORT_COLUMNS) {
    instrSheet.addRow({
      col: col.header,
      req: col.required ? "必填" : "选填",
      desc: col.description,
      example: getExampleForColumn(col.key),
    });
  }

  instrSheet.addRow({ col: "", req: "", desc: "", example: "" });
  instrSheet.addRow({
    col: "注意事项",
    req: "",
    desc: "类型只接受「菜谱」或「外卖」",
    example: "",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "外卖类型必须填写「店铺」列",
    example: "",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "权重必须是 1-10 的整数，留空默认为 1",
    example: "",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "标签用中英文逗号分隔",
    example: "川菜,家常菜",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "材料格式：名称|数量|单位（每行一种）",
    example: "五花肉|500|克",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "步骤每行一个，会自动编号",
    example: "热锅倒油",
  });
  instrSheet.addRow({
    col: "",
    req: "",
    desc: "重复的名称+类型行会被跳过",
    example: "",
  });

  // Sheet 2: Data template
  const dataSheet = workbook.addWorksheet("菜单数据");
  const columns = IMPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));
  dataSheet.columns = columns;

  const dataHeader = dataSheet.getRow(1);
  dataHeader.font = { bold: true };
  dataHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F5E9" },
  };
  dataHeader.border = {
    bottom: { style: "thin" },
  };

  // Add example rows
  dataSheet.addRow({
    kind: "菜谱",
    name: "番茄炒蛋",
    cuisineTags: "中餐,家常菜",
    categoryTags: "快手菜",
    customTags: "",
    weight: "2",
    ingredients: "番茄|2|个\n鸡蛋|3|个\n盐|适量",
    steps: "番茄切块，鸡蛋打散\n热锅倒油，炒鸡蛋\n加入番茄翻炒，调味出锅",
    tips: "酸甜口味更佳",
    shop: "",
    shopAddress: "",
  });

  dataSheet.addRow({
    kind: "外卖",
    name: "黄焖鸡米饭",
    cuisineTags: "中餐",
    categoryTags: "米饭",
    customTags: "午餐",
    weight: "",
    ingredients: "",
    steps: "",
    tips: "",
    shop: "老字号黄焖鸡",
    shopAddress: "xx路xx号",
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function getExampleForColumn(key: string): string {
  switch (key) {
    case "kind": return "菜谱";
    case "name": return "番茄炒蛋";
    case "cuisineTags": return "中餐,川菜";
    case "categoryTags": return "主食,汤";
    case "customTags": return "快手菜";
    case "weight": return "3";
    case "ingredients": return "番茄|2|个（每行一种）";
    case "steps": return "热锅倒油（每行一步）";
    case "tips": return "酸甜口味更佳";
    case "shop": return "老字号饭店";
    case "shopAddress": return "xx路xx号";
    default: return "";
  }
}
