import { describe, it, expect } from "vitest";
import {
  IMPORT_COLUMNS,
  VALID_KINDS,
  parseKindDisplay,
  generateImportTemplate,
} from "../menu-import-template";
import { loadExcelJS, resolveExcelJSModule } from "../exceljs-loader";

describe("parseKindDisplay", () => {
  it("parses 菜谱", () => {
    expect(parseKindDisplay("菜谱")).toBe("recipe");
  });

  it("parses 食谱 as recipe", () => {
    expect(parseKindDisplay("食谱")).toBe("recipe");
  });

  it("parses recipe (English)", () => {
    expect(parseKindDisplay("recipe")).toBe("recipe");
  });

  it("parses 外卖", () => {
    expect(parseKindDisplay("外卖")).toBe("takeout");
  });

  it("parses takeout (English)", () => {
    expect(parseKindDisplay("takeout")).toBe("takeout");
  });

  it("returns null for unknown", () => {
    expect(parseKindDisplay("unknown")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseKindDisplay(" 菜谱 ")).toBe("recipe");
  });

  it("returns null for empty string", () => {
    expect(parseKindDisplay("")).toBeNull();
  });
});

describe("IMPORT_COLUMNS", () => {
  it("has kind column as required", () => {
    const kindCol = IMPORT_COLUMNS.find((c) => c.key === "kind");
    expect(kindCol).toBeDefined();
    expect(kindCol!.required).toBe(true);
  });

  it("has name column as required", () => {
    const nameCol = IMPORT_COLUMNS.find((c) => c.key === "name");
    expect(nameCol).toBeDefined();
    expect(nameCol!.required).toBe(true);
  });

  it("has 11 columns", () => {
    expect(IMPORT_COLUMNS.length).toBe(11);
  });
});

describe("VALID_KINDS", () => {
  it("contains 菜谱 and 外卖", () => {
    expect(VALID_KINDS).toContain("菜谱");
    expect(VALID_KINDS).toContain("外卖");
  });
});

describe("loadExcelJS", () => {
  it("resolves browser-style default exports", async () => {
    const actual = await loadExcelJS();
    const resolved = resolveExcelJSModule(
      { default: actual } as unknown as Parameters<typeof resolveExcelJSModule>[0]
    );

    expect(resolved.Workbook).toBe(actual.Workbook);
  });
});

describe("generateImportTemplate", () => {
  it("returns a Blob", async () => {
    const blob = await generateImportTemplate();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("blob has non-zero size", async () => {
    const blob = await generateImportTemplate();
    expect(blob.size).toBeGreaterThan(0);
  });

  it("contains two sheets", async () => {
    const ExcelJS = await loadExcelJS();
    const blob = await generateImportTemplate();
    const buffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.length).toBe(2);
    expect(workbook.getWorksheet("填写说明")).toBeDefined();
    expect(workbook.getWorksheet("菜单数据")).toBeDefined();
  });

  it("data sheet has correct column headers", async () => {
    const ExcelJS = await loadExcelJS();
    const blob = await generateImportTemplate();
    const buffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const dataSheet = workbook.getWorksheet("菜单数据")!;
    const headerRow = dataSheet.getRow(1);

    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      headers.push(cell.value?.toString() ?? "");
    });

    expect(headers).toContain("类型");
    expect(headers).toContain("名称");
    expect(headers).toContain("菜系标签");
    expect(headers).toContain("店铺");
  });

  it("data sheet contains example rows", async () => {
    const ExcelJS = await loadExcelJS();
    const blob = await generateImportTemplate();
    const buffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const dataSheet = workbook.getWorksheet("菜单数据")!;
    expect(dataSheet.rowCount).toBeGreaterThanOrEqual(3); // header + 2 examples
  });
});
