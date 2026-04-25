type ExcelJSNamespace = typeof import("exceljs");
type ExcelJSDynamicModule = ExcelJSNamespace & {
  default?: ExcelJSNamespace;
};

export function resolveExcelJSModule(module: ExcelJSDynamicModule): ExcelJSNamespace {
  return module.default ?? module;
}

export async function loadExcelJS(): Promise<ExcelJSNamespace> {
  return resolveExcelJSModule((await import("exceljs")) as ExcelJSDynamicModule);
}
