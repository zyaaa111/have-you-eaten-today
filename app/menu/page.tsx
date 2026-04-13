"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { MenuItem, MenuItemKind, TagType } from "@/lib/types";
import { MenuItemFormDialog } from "@/components/menu-item-form-dialog";
import { MenuItemDetailDialog } from "@/components/menu-item-detail-dialog";
import { getWishIds, toggleWishId } from "@/lib/wishlist";
import { deleteMenuItem } from "@/lib/space-ops";
import { syncEngine } from "@/lib/sync-engine";
import { Plus, Search, ChefHat, Bike, Tag as TagIcon, Heart, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

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

export default function MenuPage() {
  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];

  const [kindFilter, setKindFilter] = useState<"all" | MenuItemKind>("all");
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | undefined>(undefined);

  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [wishIds, setWishIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useMemo(() => {
    getWishIds().then(setWishIds);
  }, []);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (selectedTagIds.length > 0 && !selectedTagIds.some((id) => item.tags.includes(id))) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const inName = item.name.toLowerCase().includes(q);
        const inShop = item.shop?.toLowerCase().includes(q) ?? false;
        if (!inName && !inShop) return false;
      }
      return true;
    });
  }, [menuItems, kindFilter, selectedTagIds, search]);

  const groupedTags = useMemo(() => {
    const g: Record<TagType, typeof allTags> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((t) => g[t.type].push(t));
    return g;
  }, [allTags]);

  const tagMap = useMemo(() => {
    const map = new Map<string, typeof allTags[number]>();
    allTags.forEach((t) => map.set(t.id, t));
    return map;
  }, [allTags]);

  const handleAdd = () => {
    setEditingItem(undefined);
    setFormOpen(true);
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormOpen(true);
    setDetailOpen(false);
  };

  const handleDelete = async (item: MenuItem) => {
    const ok = confirm(`确定删除「${item.name}」吗？`);
    if (!ok) return;
    await deleteMenuItem(item.id);
    setDetailOpen(false);
  };

  useEffect(() => {
    const sub = syncEngine.subscribeToChanges(() => {
      syncEngine.pullChanges();
    });
    // initial pull
    syncEngine.pullChanges();
    return () => sub.unsubscribe();
  }, []);

  const toggleTagFilter = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearFilters = () => {
    setKindFilter("all");
    setSearch("");
    setSelectedTagIds([]);
  };

  const toggleBatchMode = () => {
    setBatchMode((prev) => !prev);
    setSelectedIds([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedIds(filteredItems.map((i) => i.id));
  };

  const deselectAll = () => {
    setSelectedIds([]);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    const ok = confirm(`确定删除选中的 ${selectedIds.length} 项菜单吗？此操作不可恢复。`);
    if (!ok) return;
    for (const id of selectedIds) {
      await deleteMenuItem(id);
    }
    setSelectedIds([]);
    setBatchMode(false);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold">菜单管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleBatchMode}
            className={cn(
              "rounded-md border px-4 py-2 text-sm font-medium transition",
              batchMode
                ? "bg-muted text-foreground"
                : "bg-background hover:bg-muted"
            )}
          >
            {batchMode ? "完成" : "批量管理"}
          </button>
          {!batchMode && (
            <button
              onClick={handleAdd}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              新增菜单项
            </button>
          )}
        </div>
      </div>

      {/* Batch action bar */}
      {batchMode && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
          <div className="text-sm">
            已选中 <span className="font-semibold">{selectedIds.length}</span> 项
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              全选
            </button>
            <button
              onClick={deselectAll}
              className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              取消
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </div>
        </div>
      )}

      {/* Search & filters */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称或店铺…"
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {(kindFilter !== "all" || search || selectedTagIds.length > 0) && (
            <button
              onClick={clearFilters}
              className="rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              重置
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "recipe", "takeout"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                kindFilter === k
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted"
              }`}
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
                      onClick={() => toggleTagFilter(tag.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        active
                          ? typeColors[type]
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
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
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        共 {filteredItems.length} 项
      </div>

      {/* Grid */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <p className="text-muted-foreground">没有找到匹配的菜单项</p>
          <button
            onClick={handleAdd}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            新增一个
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const itemTags = item.tags.map((id) => tagMap.get(id)).filter(Boolean) as typeof allTags;
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (batchMode) {
                    toggleSelect(item.id);
                    return;
                  }
                  setDetailItem(item);
                  setDetailOpen(true);
                }}
                className={cn(
                  "cursor-pointer rounded-xl border bg-card p-4 shadow-sm transition space-y-3",
                  !batchMode && "hover:shadow-md",
                  batchMode && selectedIds.includes(item.id) && "border-primary bg-primary/5"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  {batchMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    {item.kind === "recipe" ? (
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <ChefHat className="w-4 h-4 text-orange-600" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <Bike className="w-4 h-4 text-blue-600" />
                      </div>
                    )}
                    <div>
                      <div className="font-medium line-clamp-1">{item.name}</div>
                      {item.kind === "takeout" && item.shop && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {item.shop}
                        </div>
                      )}
                    </div>
                  </div>
                  {!batchMode && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWishId(item.id).then((isWished) => {
                            setWishIds((prev) =>
                              isWished ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                            );
                          });
                        }}
                        className={cn(
                          "rounded-full p-1.5 transition",
                          wishIds.includes(item.id)
                            ? "text-red-500 bg-red-50 hover:bg-red-100"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                        title={wishIds.includes(item.id) ? "取消想吃" : "标记为想吃"}
                      >
                        <Heart className={cn("w-4 h-4", wishIds.includes(item.id) && "fill-current")} />
                      </button>
                      <span className="text-xs text-muted-foreground">w{item.weight}</span>
                    </div>
                  )}
                </div>

                {itemTags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {itemTags.slice(0, 4).map((tag) => (
                      <span
                        key={tag.id}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${typeColors[tag.type]}`}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {itemTags.length > 4 && (
                      <span className="rounded-full border px-2 py-0.5 text-[10px] bg-background text-muted-foreground">
                        +{itemTags.length - 4}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TagIcon className="w-3 h-3" /> 无标签
                  </div>
                )}

                {item.kind === "recipe" && (
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{item.ingredients?.length || 0} 种材料</span>
                    <span>{item.steps?.length || 0} 个步骤</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <MenuItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialData={editingItem}
        onSaved={() => {
          // liveQuery auto refreshes
        }}
      />

      <MenuItemDetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
