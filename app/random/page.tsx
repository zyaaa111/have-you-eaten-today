"use client";
import { reportSyncError } from "@/lib/error-monitor";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { MenuItem, MenuItemKind, Profile, TagType } from "@/lib/types";
import { rollSingle, rollCombo, type RollResult } from "@/lib/roll";
import { getDefaultDedupDays, getDedupEnabled } from "@/lib/settings";
import { MenuItemDetailDialog } from "@/components/menu-item-detail-dialog";
import { getRecommendations, type RecommendationItem } from "@/lib/recommendations";
import { scheduleProfileStateSync } from "@/lib/profile-state";
import { MenuItemFormDialog } from "@/components/menu-item-form-dialog";
import { ChefHat, Bike, Dices, Layers, ShoppingBasket } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLocalIdentity } from "@/lib/identity";
import { useAuth } from "@/components/auth-provider";
import { syncEngine } from "@/lib/sync-engine";
import { buildApiUrl } from "@/lib/api-base";
import { SETTINGS_CHANGED_EVENT } from "@/lib/syncable-settings";
import { IngredientSummaryDialog } from "@/components/ingredient-summary-dialog";

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
  const { user } = useAuth();
  const [identity, setIdentity] = useState<ReturnType<typeof getLocalIdentity>>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const templates = useLiveQuery(() => db.comboTemplates.toArray(), []) || [];
  const menuGroups = useLiveQuery(() => db.menuGroups.orderBy("sortOrder").toArray(), []) || [];
  const menuGroupItems = useLiveQuery(() => db.menuGroupItems.toArray(), []) || [];

  const [mode, setMode] = useState<"single" | "combo">("single");
  const [kind, setKind] = useState<"all" | MenuItemKind>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
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
  const [sharedRecommendations, setSharedRecommendations] = useState<RecommendationItem[]>([]);
  const [sharedRecommendationsLoading, setSharedRecommendationsLoading] = useState(false);
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [resultTimestamp, setResultTimestamp] = useState<number>(0);

  const shuffleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeScopeKey = identity ? `profile:${identity.profile.id}:${identity.space.id}` : "local";

  const visibleGroups = useMemo(
    () =>
      menuGroups.filter((group) =>
        identity
          ? group.scope === "profile" && group.profileId === identity.profile.id && group.spaceId === identity.space.id
          : group.scope === "local"
      ),
    [identity, menuGroups]
  );

  const visibleGroupItems = useMemo(
    () =>
      menuGroupItems.filter((item) =>
        identity
          ? item.profileId === identity.profile.id && item.spaceId === identity.space.id
          : !item.profileId && !item.spaceId
      ),
    [identity, menuGroupItems]
  );

  const filteredGroupMenuItemIds =
    selectedGroupId === "all"
      ? undefined
      : visibleGroupItems.filter((entry) => entry.groupId === selectedGroupId).map((entry) => entry.menuItemId);

  const localRecommendations = useLiveQuery(
    () =>
      getRecommendations({
        kind: mode === "single" && kind !== "all" ? kind : undefined,
        tagIds: mode === "single" ? selectedTagIds : undefined,
        menuItemIds: mode === "single" ? filteredGroupMenuItemIds : undefined,
        limit: 5,
      }),
    [mode, kind, selectedGroupId, JSON.stringify(selectedTagIds), JSON.stringify(filteredGroupMenuItemIds), activeScopeKey]
  ) ?? [];

  const recommendations = identity && user && selectedMemberIds.length > 1 ? sharedRecommendations : localRecommendations;
  const hasIngredientSummary =
    result?.items.some((item) => item.kind === "recipe" && item.ingredientSnapshot && item.ingredientSnapshot.length > 0) ?? false;

  useEffect(() => {
    let active = true;
    const loadRollSettings = () => {
      void getDefaultDedupDays().then((days) => {
        if (active) setDedupDays(days);
      });
      void getDedupEnabled().then((enabled) => {
        if (active) setDedupEnabled(enabled);
      });
    };

    loadRollSettings();
    window.addEventListener(SETTINGS_CHANGED_EVENT, loadRollSettings);

    const localIdentity = getLocalIdentity();
    setIdentity(localIdentity);
    if (localIdentity) {
      setSelectedMemberIds([localIdentity.profile.id]);
      void syncEngine.fetchProfiles(localIdentity.space.id).then(setMembers).catch(() => setMembers([]));
    }
    return () => {
      active = false;
      window.removeEventListener(SETTINGS_CHANGED_EVENT, loadRollSettings);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!identity || !user || selectedMemberIds.length <= 1 || mode !== "single") {
      setSharedRecommendations([]);
      setSharedRecommendationsLoading(false);
      return;
    }

    let active = true;
    const run = async () => {
      setSharedRecommendationsLoading(true);
      try {
        const recentHistoryIds = await getRecentHistoryIds();
        const response = await fetch(buildApiUrl("/recommendations/multi-member"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            space_id: identity.space.id,
            profile_ids: selectedMemberIds,
            kind: kind !== "all" ? kind : undefined,
            tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
            menu_item_ids: filteredGroupMenuItemIds,
            recent_history_ids: recentHistoryIds,
            limit: 5,
          }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as RecommendationItem[];
        if (active) {
          setSharedRecommendations(data);
        }
      } catch (error) {
        reportSyncError("Shared recommendations failed", { error: String(error) });
        if (active) {
          setSharedRecommendations([]);
        }
      } finally {
        if (active) {
          setSharedRecommendationsLoading(false);
        }
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [filteredGroupMenuItemIds, identity?.space.id, kind, mode, selectedMemberIds, selectedTagIds, user]);

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

  useEffect(() => {
    if (!autoRollPending) return;
    if (!selectedTemplateId || templates.length === 0) return;
    const exists = templates.some((template) => template.id === selectedTemplateId);
    if (!exists) {
      setAutoRollPending(false);
      return;
    }
    setMode("combo");
    setAutoRollPending(false);
    void performRoll("combo", selectedTemplateId);
  }, [autoRollPending, selectedTemplateId, templates]);

  useEffect(() => {
    return () => stopShuffle();
  }, []);

  const groupedTags = useMemo(() => {
    const grouped: Record<TagType, typeof allTags> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((tag) => grouped[tag.type].push(tag));
    return grouped;
  }, [allTags]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]));
  };

  const getShufflePool = (): ShuffleItem[] => {
    const allowedGroupIds =
      selectedGroupId === "all"
        ? null
        : new Set(
            visibleGroupItems.filter((entry) => entry.groupId === selectedGroupId).map((entry) => entry.menuItemId)
          );
    if (mode === "combo") {
      return menuItems
        .filter((item) => !allowedGroupIds || allowedGroupIds.has(item.id))
        .map((item) => ({ name: item.name, kind: item.kind, shop: item.shop }));
    }

    let pool = menuItems.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (selectedTagIds.length > 0 && !selectedTagIds.some((tagId) => item.tags.includes(tagId))) return false;
      if (allowedGroupIds && !allowedGroupIds.has(item.id)) return false;
      return true;
    });
    if (pool.length === 0) pool = menuItems;
    return pool.map((item) => ({ name: item.name, kind: item.kind, shop: item.shop }));
  };

  const startShuffle = (pool: ShuffleItem[]) => {
    if (pool.length === 0) return;
    let index = 0;
    if (shuffleTimerRef.current) clearInterval(shuffleTimerRef.current);
    shuffleTimerRef.current = setInterval(() => {
      index = (index + 1) % pool.length;
      setShuffleDisplay(pool[index]!);
    }, 80);
  };

  const stopShuffle = () => {
    if (shuffleTimerRef.current) {
      clearInterval(shuffleTimerRef.current);
      shuffleTimerRef.current = null;
    }
    setShuffleDisplay(null);
  };

  const performRoll = async (rollMode: "single" | "combo" = mode, templateId: string | null = selectedTemplateId) => {
    setResult(null);
    setRolling(true);
    const pool = getShufflePool();
    startShuffle(pool);

    const minShuffleTime = 700;
    const startTime = Date.now();

    try {
      let nextResult: RollResult | null = null;
      const shouldUseSharedRoll = !!identity && !!user && selectedMemberIds.length > 1;

      if (shouldUseSharedRoll) {
        const recentHistoryIds = await getRecentHistoryIds();
        const response = await fetch(buildApiUrl("/roll/multi-member"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            space_id: identity.space.id,
            profile_ids: selectedMemberIds,
            kind: rollMode === "single" && kind !== "all" ? kind : undefined,
            tag_ids: rollMode === "single" && selectedTagIds.length > 0 ? selectedTagIds : undefined,
            menu_item_ids: rollMode === "single" ? filteredGroupMenuItemIds : undefined,
            recent_history_ids: recentHistoryIds,
            template_id: rollMode === "combo" ? templateId : undefined,
          }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        nextResult = (await response.json()) as RollResult;
        const enrichedItems = nextResult.items.map((ri) => {
          if (ri.ingredientSnapshot) return ri;
          if (ri.kind !== "recipe") return ri;
          const local = menuItems.find((mi) => mi.id === ri.menuItemId);
          if (!local?.ingredients?.length) return ri;
          return {
            ...ri,
            ingredientSnapshot: local.ingredients.map(({ name, amount, quantity, unit }) => ({ name, amount, quantity, unit })),
          };
        });
        const historyId = crypto.randomUUID();
        await db.rollHistory.add({
          id: historyId,
          rolledAt: Date.now(),
          items: enrichedItems,
          ruleSnapshot: nextResult.ruleSnapshot,
          ignoredDedup: nextResult.ignoredDedup,
        });
        scheduleProfileStateSync({ collection: "rollHistory", key: historyId });
      } else if (rollMode === "single") {
        nextResult = await rollSingle({
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
        nextResult = await rollCombo({
          templateId,
          ignoreDedup,
        });
      }

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minShuffleTime - elapsed);
      await new Promise((resolve) => setTimeout(resolve, remaining));

      stopShuffle();
      setResult(nextResult);
      setResultTimestamp(Date.now());
    } finally {
      stopShuffle();
      setRolling(false);
    }
  };

  const openDetail = async (item: RollResult["items"][number]) => {
    const full = menuItems.find((menuItem) => menuItem.id === item.menuItemId) || null;
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
    setResult((prev: RollResult | null) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((entry) => entry.menuItemId !== item.id),
          }
        : null
    );
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center py-4 md:py-8">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">今天吃什么？</h2>
        <p className="text-muted-foreground">让随机来帮你做决定</p>
      </div>

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

      <div className="rounded-xl border bg-card p-4 space-y-4">
        {mode === "single" ? (
          <>
            <div className="flex flex-wrap gap-2">
              {(["all", "recipe", "takeout"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setKind(value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    kind === value ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                  )}
                >
                  {value === "all" ? "全部" : value === "recipe" ? "菜谱" : "外卖"}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground w-10">清单</span>
                <select
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(event.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">全部菜单</option>
                  {visibleGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              {(["cuisine", "category", "custom"] as TagType[]).map((type) =>
                groupedTags[type].length > 0 ? (
                  <div key={type} className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-muted-foreground w-10">{typeLabels[type]}</span>
                    {groupedTags[type].map((tag) => {
                      const active = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition",
                            active ? typeColors[type] : "bg-background text-muted-foreground hover:bg-muted"
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
              <div className="text-sm text-muted-foreground">还没有组合模板，先到「模板」页面创建一个吧。</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={cn(
                      "text-left rounded-lg border px-4 py-3 transition",
                      selectedTemplateId === template.id ? "border-primary bg-primary/5" : "bg-background hover:bg-muted"
                    )}
                  >
                    <div className="font-medium">{template.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {template.rules.length} 条规则 · 共 {template.rules.reduce((sum, rule) => sum + rule.count, 0)} 项
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {identity && members.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <div className="text-sm font-medium">参与成员</div>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => {
                const checked = selectedMemberIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    disabled={!member.isAccountBound}
                    onClick={() => {
                      if (!member.isAccountBound) return;
                      setSelectedMemberIds((prev) => {
                        if (prev.includes(member.id)) {
                          if (prev.length === 1) return prev;
                          return prev.filter((id) => id !== member.id);
                        }
                        return [...prev, member.id];
                      });
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition",
                      checked
                        ? "border-primary bg-primary/10 text-primary"
                        : member.isAccountBound
                          ? "bg-background hover:bg-muted"
                          : "cursor-not-allowed bg-muted/40 text-muted-foreground"
                    )}
                  >
                    {checked ? "✓ " : ""}
                    {member.nickname}
                    {!member.isAccountBound ? "（待绑定）" : ""}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              每次手动选择参与成员。多人模式下只展示汇总结果和汇总理由，不会暴露其他成员的私有偏好明细。
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2">
            <input
              id="ignoreDedup"
              type="checkbox"
              checked={!dedupEnabled || ignoreDedup}
              disabled={!dedupEnabled}
              onChange={(event) => setIgnoreDedup(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
            />
            <label
              htmlFor="ignoreDedup"
              className={cn("text-sm cursor-pointer", dedupEnabled ? "text-muted-foreground" : "text-muted-foreground/60")}
            >
              忽略近期去重
            </label>
          </div>
          {dedupEnabled ? (
            !ignoreDedup && <span className="text-xs text-muted-foreground">近 {dedupDays} 天内不重复</span>
          ) : (
            <span className="text-xs text-amber-600">当前已全局关闭去重</span>
          )}
        </div>
      </div>

      {mode === "single" && (recommendations.length > 0 || sharedRecommendationsLoading) && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div>
            <div className="text-sm font-medium">推荐候选</div>
            <div className="text-xs text-muted-foreground">
              {identity && user && selectedMemberIds.length > 1
                ? "当前展示的是多人聚合推荐结果，只返回汇总理由，不返回成员私有偏好明细。"
                : "推荐不会替代随机，只是给你一个更快的候选列表。"}
            </div>
          </div>
          {sharedRecommendationsLoading ? (
            <div className="text-sm text-muted-foreground">正在计算多人推荐…</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recommendations.map(({ item, reasons, score }) => (
                <button
                  key={item.id}
                  onClick={() => openDetail({ menuItemId: item.id, name: item.name, kind: item.kind, shop: item.shop })}
                  className="rounded-lg border bg-background p-3 text-left hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{item.name}</div>
                    <div className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {score.toFixed(1)}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{reasons.slice(0, 3).join(" · ") || "综合推荐"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={() => void performRoll()}
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
              <div className="text-sm text-muted-foreground mb-1">{result ? result.ruleSnapshot : "正在抽取…"}</div>
              <div className="text-lg font-semibold">{mode === "single" ? "抽取结果" : "组合结果"}</div>
            </div>

            <div className="space-y-3">
              {(result?.items || (rolling && shuffleDisplay ? [shuffleDisplay] : [])).map((item: RollResult["items"][number] | ShuffleItem, index: number) => (
                <button
                  key={index}
                  onClick={() => {
                    if (result && "menuItemId" in item) {
                      void openDetail(item as RollResult["items"][number]);
                    }
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
                    {item.shop && <div className="text-sm text-muted-foreground truncate">{item.shop}</div>}
                  </div>
                  {result && <div className="text-sm text-muted-foreground">查看详情 →</div>}
                </button>
              ))}
            </div>

            {result && (
              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={() => void performRoll()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 active:scale-95 transition"
                >
                  <Dices className="w-4 h-4" />
                  再抽一次
                </button>
                <button
                  onClick={() => setIngredientDialogOpen(true)}
                  disabled={!hasIngredientSummary}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium transition",
                    hasIngredientSummary ? "hover:bg-muted active:scale-95" : "opacity-50 cursor-not-allowed"
                  )}
                  title={hasIngredientSummary ? undefined : "当前结果没有菜谱材料"}
                >
                  <ShoppingBasket className="w-4 h-4" />
                  查看材料清单
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !rolling && <div className="text-center text-sm text-muted-foreground">当前菜单共 {menuItems.length} 项，准备好就开始吧！</div>}

      <MenuItemDetailDialog item={detailItem} open={detailOpen} onOpenChange={setDetailOpen} onEdit={handleEdit} onDelete={handleDelete} />

      <IngredientSummaryDialog
        open={ingredientDialogOpen}
        onClose={() => setIngredientDialogOpen(false)}
        items={result?.items ?? []}
        rolledAt={resultTimestamp}
        menuItems={menuItems}
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

async function getRecentHistoryIds(): Promise<string[]> {
  const history = await db.rollHistory.orderBy("rolledAt").reverse().limit(20).toArray();
  return Array.from(new Set(history.flatMap((entry) => entry.items.map((item) => item.menuItemId))));
}
