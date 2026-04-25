import type { RolledItem } from "./types";
import type { SummaryLine } from "./ingredient-summary";
import { formatDateTime } from "./format-date";

interface FormatOptions {
  rolledAt: number;
  items: RolledItem[];
}

export function formatIngredientText(summary: SummaryLine[], options: FormatOptions): string {
  const { rolledAt, items } = options;

  const preciseLines = summary.filter((line) => line.merged);
  const vagueLines = summary.filter((line) => !line.merged);
  const takeoutCount = items.filter((item) => item.kind === "takeout").length;
  const hasTakeout = takeoutCount > 0;

  const lines: string[] = [];

  // Header
  lines.push(`材料清单（${formatDateTime(rolledAt)}）`);

  if (summary.length > 0) {
    // Precise section
    if (preciseLines.length > 0) {
      lines.push("── 精确汇总 ──");
      for (const line of preciseLines) {
        lines.push(`${line.name} ${line.totalQuantity}${line.unit ?? ""}`);
      }
    }

    // Vague section
    if (vagueLines.length > 0) {
      lines.push("── 需分别准备 ──");
      for (const line of vagueLines) {
        const source = line.sources[0] ? `（${line.sources[0]}）` : "";
        const amount = line.amount ? ` ${line.amount}` : "";
        lines.push(`${line.name}${amount}${source}`);
      }
    }
  }

  // Takeout note
  if (hasTakeout) {
    lines.push("── 说明 ──");
    lines.push(`本次结果含 ${takeoutCount} 项外卖，不生成采购材料`);
  }

  return lines.join("\n");
}
