"use client";

import { useMemo, useState, useCallback } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import type { MenuItem, RolledItem } from "@/lib/types";
import { summarizeIngredients, type SummaryLine } from "@/lib/ingredient-summary";
import { formatIngredientText } from "@/lib/ingredient-format";
import { formatDateTime } from "@/lib/format-date";
import { Modal } from "@/components/ui/modal";
import { ShoppingBasket, Copy, Check } from "lucide-react";

const EMPTY_MENU_ITEMS: MenuItem[] = [];

interface IngredientSummaryDialogProps {
  open: boolean;
  onClose: () => void;
  items: RolledItem[];
  rolledAt: number;
  menuItems?: MenuItem[];
}

export function IngredientSummaryDialog({
  open,
  onClose,
  items,
  rolledAt,
  menuItems: menuItemsProp,
}: IngredientSummaryDialogProps) {
  const [copied, setCopied] = useState(false);
  const shouldLoadMenuItems = !menuItemsProp;

  // Only query IndexedDB when caller doesn't provide menuItems
  const liveMenuItems = useLiveQuery(
    () => shouldLoadMenuItems ? db.menuItems.toArray() : EMPTY_MENU_ITEMS,
    [shouldLoadMenuItems]
  );
  const allMenuItems = menuItemsProp ?? liveMenuItems ?? EMPTY_MENU_ITEMS;

  const enrichedItems = useMemo<RolledItem[]>(() => {
    if (!allMenuItems || allMenuItems.length === 0) return items;
    return items.map((item) => {
      if (item.kind !== "recipe") return item;
      if (item.ingredientSnapshot && item.ingredientSnapshot.length > 0) return item;
      const found = allMenuItems.find((mi) => mi.id === item.menuItemId);
      if (found?.ingredients?.length) {
        return {
          ...item,
          ingredientSnapshot: found.ingredients.map(({ name, amount, quantity, unit }) => ({
            name,
            amount,
            quantity,
            unit,
          })),
        };
      }
      return item;
    });
  }, [items, allMenuItems]);

  const summary = useMemo(() => summarizeIngredients(enrichedItems), [enrichedItems]);

  const preciseLines = useMemo(() => summary.filter((l) => l.merged), [summary]);
  const vagueLines = useMemo(() => summary.filter((l) => !l.merged), [summary]);
  const takeoutCount = useMemo(() => items.filter((i) => i.kind === "takeout").length, [items]);
  const recipeCount = useMemo(() => items.filter((i) => i.kind === "recipe").length, [items]);

  const hasMissingSnapshot = useMemo(() => {
    return enrichedItems.some(
      (item) => item.kind === "recipe" && (!item.ingredientSnapshot || item.ingredientSnapshot.length === 0)
    );
  }, [enrichedItems]);

  const handleCopy = useCallback(() => {
    const text = formatIngredientText(summary, { rolledAt, items });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Clipboard API unavailable (non-HTTPS, permission denied, etc.)
    });
  }, [summary, rolledAt, items]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="材料清单"
      fullScreen
      footer={
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={onClose}
            className="flex-1 sm:flex-none rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition"
          >
            关闭
          </button>
          <button
            onClick={handleCopy}
            disabled={summary.length === 0 && takeoutCount === 0}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "已复制" : "复制清单"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Stats line */}
        <div className="text-sm text-muted-foreground">
          {formatDateTime(rolledAt)} · {recipeCount}道菜
          {preciseLines.length > 0 && ` · ${preciseLines.length}项精确合并`}
          {vagueLines.length > 0 && ` · ${vagueLines.length}项需分别准备`}
        </div>

        {summary.length === 0 && takeoutCount === 0 && (
          <div className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            暂无材料数据
          </div>
        )}

        {/* Precise section */}
        {preciseLines.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">精确汇总</div>
            <div className="rounded-lg border bg-background">
              {preciseLines.map((line, i) => (
                <div
                  key={`${line.name}-${i}`}
                  className="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0 text-sm"
                >
                  <span>{line.name}</span>
                  <span className="font-medium tabular-nums">
                    {line.totalQuantity}{line.unit ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vague section */}
        {vagueLines.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">需分别准备</div>
            <div className="rounded-lg border bg-background">
              {vagueLines.map((line, i) => (
                <div
                  key={`${line.name}-${i}`}
                  className="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0 text-sm"
                >
                  <span>
                    {line.name}
                    {line.amount ? <span className="ml-1 text-muted-foreground">{line.amount}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{line.sources[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Takeout banner */}
        {takeoutCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            本次结果含 {takeoutCount} 项外卖，不生成采购材料
          </div>
        )}

        {/* Missing snapshot warning */}
        {hasMissingSnapshot && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            部分菜谱未记录材料信息，显示可能不完整
          </div>
        )}
      </div>
    </Modal>
  );
}
