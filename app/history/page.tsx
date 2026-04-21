"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { clearRollHistory, rollSingle, rollCombo } from "@/lib/roll";
import { scheduleProfileStateSync } from "@/lib/profile-state";
import { ChefHat, Bike, Trash2, Dices } from "lucide-react";
import { cn } from "@/lib/utils";
import { MenuItem } from "@/lib/types";
import { MenuItemDetailDialog } from "@/components/menu-item-detail-dialog";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function HistoryPage() {
  const history = useLiveQuery(() => db.rollHistory.orderBy("rolledAt").reverse().toArray(), []) || [];
  const templates = useLiveQuery(() => db.comboTemplates.toArray(), []) || [];
  const [replacing, setReplacing] = useState(false);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleItemClick = async (menuItemId: string, name: string) => {
    const item = await db.menuItems.get(menuItemId);
    if (item) {
      setDetailItem(item);
      setDetailOpen(true);
    } else {
      alert(`「${name}」已被删除`);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, typeof history>();
    for (const h of history) {
      const key = new Date(h.rolledAt).toLocaleDateString("zh-CN");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return Array.from(map.entries());
  }, [history]);

  const handleClear = async () => {
    const ok = confirm("确定清空所有抽取历史记录吗？此操作不可恢复。");
    if (!ok) return;
    await clearRollHistory();
  };

  const handleRerollToday = async (todayRecords: typeof history) => {
    if (todayRecords.length === 0) return;
    setReplacing(true);
    try {
      const latest = todayRecords[0];
      const idsToDelete = todayRecords.map((r) => r.id);
      await db.rollHistory.bulkDelete(idsToDelete);
      scheduleProfileStateSync(idsToDelete.map((id) => ({ collection: "rollHistory", key: id })));

      let result = null;
      if (latest.items.length > 1) {
        const matchedTemplate = templates.find((t) => t.name === latest.ruleSnapshot);
        if (matchedTemplate) {
          result = await rollCombo({ templateId: matchedTemplate.id, ignoreDedup: true });
        }
        if (!result) {
          result = await rollSingle({ kind: latest.items[0]?.kind, ignoreDedup: true });
        }
      } else {
        result = await rollSingle({ kind: latest.items[0]?.kind, ignoreDedup: true });
      }

      if (!result) {
        alert("候选池不足，无法重新抽取。请尝试放宽条件或添加更多菜单项。");
      }
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">抽取历史</h2>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
            清空历史
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <p className="text-muted-foreground">还没有抽取记录</p>
          <p className="text-sm text-muted-foreground mt-1">快去「随机」页面试试吧</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, records]) => {
            const today = isToday(records[0].rolledAt);
            return (
              <div key={date} className="space-y-3">
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 flex items-center justify-between">
                  <div className="text-sm font-semibold text-muted-foreground">{date}</div>
                  {today && (
                    <button
                      onClick={() => handleRerollToday(records)}
                      disabled={replacing}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition",
                        replacing
                          ? "text-muted-foreground cursor-not-allowed"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      <Dices className="w-3.5 h-3.5" />
                      {replacing ? "抽取中…" : "重新抽取"}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {records.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-xl border bg-card p-4 shadow-sm space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm text-muted-foreground">
                          {formatDate(record.rolledAt)} · {relativeTime(record.rolledAt)}
                        </div>
                        {record.ignoredDedup && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                            允许重复
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-medium">{record.ruleSnapshot}</div>

                      <div className="flex flex-wrap gap-2">
                        {record.items.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleItemClick(item.menuItemId, item.name)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm active:bg-white/50 transition-colors cursor-pointer",
                              item.kind === "recipe"
                                ? "bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100"
                                : "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100"
                            )}
                          >
                            {item.kind === "recipe" ? (
                              <ChefHat className="w-3.5 h-3.5" />
                            ) : (
                              <Bike className="w-3.5 h-3.5" />
                            )}
                            <span className="font-medium">{item.name}</span>
                            {item.shop && (
                              <span className="text-xs opacity-80">· {item.shop}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MenuItemDetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
