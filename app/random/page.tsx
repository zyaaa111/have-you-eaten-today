"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { MenuItem, MenuItemKind, TagType } from "@/lib/types";
import { rollSingle, rollCombo, RollResult } from "@/lib/roll";
import { getDefaultDedupDays, getDedupEnabled } from "@/lib/settings";
import { MenuItemDetailDialog } from "@/components/menu-item-detail-dialog";
import { MenuItemFormDialog } from "@/components/menu-item-form-dialog";
import { ChefHat, Bike, Dices, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const typeLabels: Record<TagType, string> = {
  cuisine: "菜系",
  category: "类别",
  custom: "自定义",
};

const typeColors: Record<TagType, string> = {
  cuisine: "bg-amber-100 text-amber-700 border-amber-200",
  category: "bg-emerald-100 text-emerald-700 border-emerald-200",
  custom: "bg-slate-100 text-slate-700 border-slate-200",
};

interface ShuffleItem {
  name: string;
  kind: MenuItemKind;
  shop?: string;
}

export default function RandomPage() {
  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const templates = useLiveQuery(() => db.comboTemplates.toArray(), []) || [];

  const [mode, setMode] = useState<"single" | "combo">("single");
  const [kind, setKind] = useState<"all" | MenuItemKind>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [ignoreDedup, setIgnoreDedup] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<RollResult | null>(null);
  const [shuffleDisplay, setShuffleDisplay] = useState<ShuffleItem | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | undefined>(undefined);
  const [autoRollPending, setAutoRollPending] = useState(false);
  const [dedupDays, setDedupDays] = useState<number>(7);
  const [dedupEnabled, setDedupEnabled] = useState<boolean>(true);
  const shuffleTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    getDefaultDedupDays().then(setDedupDays);
    getDedupEnabled().then(setDedupEnabled);
  }, []);

  // 从 URL 解析 kind / templateId 参数
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const k = params.get("kind");
      if (k === "recipe" || k === "takeout") {
        setKind(k);
      }
      const t = params.get("templateId");
      if (t) {
        setSelectedTemplateId(t);
        setAutoRollPending(true);
      }
    }
  }, []);

  // 自动触发组合抽（从模板页「试用」跳转而来）
  useEffect(() => {
    if (!autoRollPending) return;
    if (!selectedTemplateId || templates.length === 0) return;
    const exists = templates.some((t) => t.id === selectedTemplateId);
    if (!exists) {
      setAutoRollPending(false);
      return;
    }
    setMode("combo");
    setAutoRollPending(false);
    performRoll("combo", selectedTemplateId);
  }, [autoRollPending, selectedTemplateId, templates]);

  const groupedTags = useMemo(() => {
    const g: Record<TagType, typeof allTags> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((t) => g[t.type].push(t));
    return g;
  }, [allTags]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const getShufflePool = (): ShuffleItem[] => {
    if (mode === "combo") {
      return menuItems.map((m) => ({ name: m.name, kind: m.kind, shop: m.shop }));
    }
    let pool = menuItems.filter((m) => {
      if (kind !== "all" && m.kind !== kind) return false;
      if (selectedTagIds.length > 0 && !selectedTagIds.some((tid) => m.tags.includes(tid))) return false;
      return true;
    });
    if (pool.length === 0) pool = menuItems;
    return pool.map((m) => ({ name: m.name, kind: m.kind, shop: m.shop }));
  };

  const startShuffle = (pool: ShuffleItem[]) => {
    if (pool.length === 0) return;
    let idx = 0;
    if (shuffleTimerRef.current) clearInterval(shuffleTimerRef.current);
    shuffleTimerRef.current = setInterval(() => {
      idx = (idx + 1) % pool.length;
      setShuffleDisplay(pool[idx]);
    }, 80);
  };

  const stopShuffle = () => {
    if (shuffleTimerRef.current) {
      clearInterval(shuffleTimerRef.current);
      shuffleTimerRef.current = null;
    }
    setShuffleDisplay(null);
  };

  const performRoll = async (
    rollMode: "single" | "combo" = mode,
    templateId: string | null = selectedTemplateId
  ) => {
    setResult(null);
    setRolling(true);
    const pool = getShufflePool();
    startShuffle(pool);

    const minShuffleTime = 700;
    const startTime = Date.now();

    try {
      let res: RollResult | null = null;
      if (rollMode === "single") {
        res = await rollSingle({
          kind: kind === "all" ? undefined : kind,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          ignoreDedup,
        });
      } else {
        if (!templateId) {
          stopShuffle();
          setRolling(false);
          return;
        }
        res = await rollCombo({
          templateId,
          ignoreDedup,
        });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minShuffleTime - elapsed);
      await new Promise((resolve) => setTimeout(resolve, remaining));

      stopShuffle();
      setResult(res);
    } finally {
      stopShuffle();
      setRolling(false);
    }
  };

  const handleRoll = () => performRoll();

  const openDetail = (item: RollResult["items"][number]) => {
    const full = menuItems.find((m) => m.id === item.menuItemId) || null;
    if (full) {
      setDetailItem(full);
      setDetailOpen(true);
    }
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormOpen(true);
    setDetailOpen(false);
  };

  const handleDelete = async (item: MenuItem) => {
    const ok = confirm(`确定删除「${item.name}」吗？`);
    if (!ok) return;
    await db.menuItems.delete(item.id);
    setDetailOpen(false);
    // 如果当前结果中包含被删除的项，建议刷新结果展示（可选）
    setResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((i) => i.menuItemId !== item.id),
          }
        : null
    );
  };

  // 清理定时器
  useEffect(() => {
    return () => stopShuffle();
  }, []);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center py-4 md:py-8">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">今天吃什么？</h2>
        <p className="text-muted-foreground">让随机来帮你做决定</p>
      </div>

      {/* Mode switch */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border bg-muted p-1">
          <button
            onClick={() => setMode("single")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-full transition",
              mode === "single" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            单抽
          </button>
          <button
            onClick={() => setMode("combo")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-full transition",
              mode === "combo" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            组合抽
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        {mode === "single" ? (
          <>
            <div className="flex flex-wrap gap-2">
              {(["all", "recipe", "takeout"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    kind === k
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  )}
                >
                  {k === "all" ? "全部" : k === "recipe" ? "菜谱" : "外卖"}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {(["cuisine", "category", "custom"] as TagType[]).map((type) =>
                groupedTags[type].length > 0 ? (
                  <div key={type} className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-muted-foreground w-10">
                      {typeLabels[type]}
                    </span>
                    {groupedTags[type].map((tag) => {
                      const active = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition",
                            active
                              ? typeColors[type]
                              : "bg-background text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {active ? "✓ " : ""}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <Layers className="w-4 h-4" />
              选择模板
            </div>
            {templates.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                还没有组合模板，先到「模板」页面创建一个吧。
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplateId(t.id)}
                    className={cn(
                      "text-left rounded-lg border px-4 py-3 transition",
                      selectedTemplateId === t.id
                        ? "border-primary bg-primary/5"
                        : "bg-background hover:bg-muted"
                    )}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t.rules.length} 条规则 · 共 {t.rules.reduce((s, r) => s + r.count, 0)} 项
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2">
            <input
              id="ignoreDedup"
              type="checkbox"
              checked={!dedupEnabled || ignoreDedup}
              disabled={!dedupEnabled}
              onChange={(e) => setIgnoreDedup(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
            />
            <label
              htmlFor="ignoreDedup"
              className={`text-sm cursor-pointer ${dedupEnabled ? "text-muted-foreground" : "text-muted-foreground/60"}`}
            >
              忽略近期去重
            </label>
          </div>
          {dedupEnabled ? (
            !ignoreDedup && (
              <span className="text-xs text-muted-foreground">
                近 {dedupDays} 天内不重复
              </span>
            )
          ) : (
            <span className="text-xs text-amber-600">当前已全局关闭去重</span>
          )}
        </div>
      </div>

      {/* Roll button */}
      <div className="flex justify-center">
        <button
          onClick={handleRoll}
          disabled={rolling || (mode === "combo" && !selectedTemplateId)}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-8 py-4 text-lg font-semibold shadow-lg transition",
            rolling || (mode === "combo" && !selectedTemplateId)
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-xl active:scale-95"
          )}
        >
          <Dices className={cn("w-6 h-6", rolling && "animate-spin")} />
          {rolling ? "抽取中…" : mode === "single" ? "开始单抽" : "开始组合抽"}
        </button>
      </div>

      {/* Result or Shuffle */}
      {(result || (rolling && shuffleDisplay)) && (
        <div className="space-y-4 animate-in fade-in zoom-in duration-300">
          {result?.ignoredDedup && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 flex items-center gap-2">
              <span>⚠️</span>
              近期已抽过的项目被排除后无可用选项，本次已放宽限制
            </div>
          )}

          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">
                {result ? result.ruleSnapshot : "正在抽取…"}
              </div>
              <div className="text-lg font-semibold">
                {mode === "single" ? "抽取结果" : "组合结果"}
              </div>
            </div>

            <div className="space-y-3">
              {(result?.items || (rolling && shuffleDisplay ? [shuffleDisplay] : [])).map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    if (result && "menuItemId" in item) openDetail(item as RollResult["items"][number]);
                  }}
                  disabled={!result}
                  className={cn(
                    "w-full flex items-center gap-4 rounded-xl border bg-background p-4 text-left transition",
                    result ? "hover:bg-muted/50" : "opacity-90"
                  )}
                >
                  <div
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                      item.kind === "recipe" ? "bg-orange-100" : "bg-blue-100"
                    )}
                  >
                    {item.kind === "recipe" ? (
                      <ChefHat className="w-6 h-6 text-orange-600" />
                    ) : (
                      <Bike className="w-6 h-6 text-blue-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-bold truncate">{item.name}</div>
                    {item.shop && (
                      <div className="text-sm text-muted-foreground truncate">{item.shop}</div>
                    )}
                  </div>
                  {result && <div className="text-sm text-muted-foreground">查看详情 →</div>}
                </button>
              ))}
            </div>

            {result && (
              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={handleRoll}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 active:scale-95 transition"
                >
                  <Dices className="w-4 h-4" />
                  再抽一次
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !rolling && (
        <div className="text-center text-sm text-muted-foreground">
          当前菜单共 {menuItems.length} 项，准备好就开始吧！
        </div>
      )}

      <MenuItemDetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <MenuItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialData={editingItem}
        onSaved={() => {
          // liveQuery auto refreshes
        }}
      />
    </div>
  );
}
