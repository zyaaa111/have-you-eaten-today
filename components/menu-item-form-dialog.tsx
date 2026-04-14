"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { MenuItem, MenuItemKind, Tag, TagType, ChangeLog, Ingredient, RecipeStep } from "@/lib/types";
import { createMenuItem, updateMenuItem } from "@/lib/space-ops";
import { syncEngine } from "@/lib/sync-engine";
import { v4 as uuidv4 } from "uuid";
import { Modal } from "@/components/ui/modal";
import {
  ChefHat,
  Bike,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageUploader } from "@/components/image-uploader";

interface MenuItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: MenuItem;
  onSaved?: () => void;
}

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

export function MenuItemFormDialog({
  open,
  onOpenChange,
  initialData,
  onSaved,
}: MenuItemFormDialogProps) {
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const shopHistory = useLiveQuery(
    async () => {
      const items = await db.menuItems.where("kind").equals("takeout").toArray();
      return Array.from(new Set(items.map((i) => i.shop).filter(Boolean) as string[]));
    },
    []
  ) || [];
  const isEdit = Boolean(initialData);

  const [kind, setKind] = useState<MenuItemKind>("recipe");
  const [name, setName] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [weight, setWeight] = useState(1);
  const [ingredients, setIngredients] = useState<{ name: string; amount: string }[]>([]);
  const [steps, setSteps] = useState<{ description: string; durationMinutes?: number }[]>([]);
  const [tips, setTips] = useState("");
  const [shop, setShop] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [recentEditWarning, setRecentEditWarning] = useState<string>("");

  const draftKey = isEdit && initialData ? `hyet_draft_${initialData.id}` : "hyet_draft_new";

  useEffect(() => {
    if (open) {
      // Load draft if exists
      const draftRaw = typeof window !== "undefined" ? localStorage.getItem(draftKey) : null;
      let draft: Partial<MenuItem> | null = null;
      if (draftRaw) {
        try {
          draft = JSON.parse(draftRaw);
        } catch {}
      }

      if (initialData) {
        setKind(draft?.kind || initialData.kind);
        setName(draft?.name ?? initialData.name);
        setSelectedTagIds(draft?.tags ?? initialData.tags);
        setWeight(draft?.weight ?? initialData.weight);
        setIngredients(
          ((draft?.ingredients as Ingredient[] | undefined)?.map((i) => ({ name: i.name, amount: i.amount || "" })))
            ?? (initialData.ingredients?.map((i) => ({ name: i.name, amount: i.amount || "" })) || [])
        );
        setSteps(
          ((draft?.steps as RecipeStep[] | undefined)?.map((s) => ({
            description: s.description,
            durationMinutes: s.durationMinutes,
          })))
            ?? (initialData.steps?.map((s) => ({
              description: s.description,
              durationMinutes: s.durationMinutes,
            })) || [])
        );
        setTips(draft?.tips ?? (initialData.tips || ""));
        setShop(draft?.shop ?? (initialData.shop || ""));
        setShopAddress(draft?.shopAddress ?? (initialData.shopAddress || ""));
        setImageUrl(draft?.imageUrl ?? initialData.imageUrl);

        // Check recent edits by others
        syncEngine.fetchChangeLogsForRecord("menu_items", initialData.id).then((logs) => {
          const recent = logs.find(
            (l) => l.operation === "update" && Date.now() - l.createdAt < 30_000
          );
          if (recent) {
            setRecentEditWarning("此菜单在近 30 秒内被他人修改过，保存时将以你的版本为准，旧版本可在历史记录中找回。");
          } else {
            setRecentEditWarning("");
          }
        });
      } else {
        setKind(draft?.kind || "recipe");
        setName(draft?.name ?? "");
        setSelectedTagIds(draft?.tags ?? []);
        setWeight(draft?.weight ?? 1);
        setIngredients(
          (draft?.ingredients as Ingredient[] | undefined)?.map((i) => ({ name: i.name, amount: i.amount || "" })) || []
        );
        setSteps(
          (draft?.steps as RecipeStep[] | undefined)?.map((s) => ({
            description: s.description,
            durationMinutes: s.durationMinutes,
          })) || []
        );
        setTips(draft?.tips ?? "");
        setShop(draft?.shop ?? "");
        setShopAddress(draft?.shopAddress ?? "");
        setImageUrl(draft?.imageUrl ?? undefined);
        setRecentEditWarning("");
      }
      setError("");
    }
  }, [open, initialData, draftKey]);

  // Auto-save draft
  useEffect(() => {
    if (!open) return;
    const payload: Partial<MenuItem> = {
      kind,
      name,
      tags: selectedTagIds,
      weight,
      ingredients: ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), amount: i.amount.trim() || undefined })),
      steps: steps.filter((s) => s.description.trim()).map((s, idx) => ({ order: idx + 1, description: s.description.trim(), durationMinutes: s.durationMinutes })),
      tips: tips.trim() || undefined,
      shop: shop.trim() || undefined,
      shopAddress: shopAddress.trim() || undefined,
      imageUrl,
    };
    localStorage.setItem(draftKey, JSON.stringify(payload));
  }, [kind, name, selectedTagIds, weight, ingredients, steps, tips, shop, shopAddress, open, draftKey]);

  const groupedTags = useMemo(() => {
    const g: Record<TagType, Tag[]> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((t) => g[t.type].push(t));
    return g;
  }, [allTags]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleAddIngredient = () => {
    setIngredients((prev) => [...prev, { name: "", amount: "" }]);
  };

  const handleUpdateIngredient = (idx: number, field: "name" | "amount", value: string) => {
    setIngredients((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveIngredient = (idx: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddStep = () => {
    setSteps((prev) => [...prev, { description: "" }]);
  };

  const handleUpdateStep = (idx: number, field: "description" | "durationMinutes", value: string) => {
    setSteps((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              [field]: field === "durationMinutes" ? (value ? Number(value) : undefined) : value,
            }
          : item
      )
    );
  };

  const handleRemoveStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // 必须设置 dataTransfer，否则某些浏览器不触发 drag
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    setSteps((prev) => {
      const next = [...prev];
      const [removed] = next.splice(draggedIdx, 1);
      next.splice(idx, 0, removed);
      return next;
    });
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("请输入名称");
      return;
    }
    if (kind === "takeout" && !shop.trim()) {
      setError("请输入店铺名称");
      return;
    }

    const now = Date.now();
    const base = {
      kind,
      name: name.trim(),
      tags: selectedTagIds,
      weight,
      updatedAt: now,
      imageUrl,
    };

    if (isEdit && initialData) {
      const updatePayload: Partial<MenuItem> = { ...base };
      if (kind === "recipe") {
        updatePayload.ingredients = ingredients
          .filter((i) => i.name.trim())
          .map((i) => ({ name: i.name.trim(), amount: i.amount.trim() || undefined }));
        updatePayload.steps = steps
          .filter((s) => s.description.trim())
          .map((s, idx) => ({
            order: idx + 1,
            description: s.description.trim(),
            durationMinutes: s.durationMinutes,
          }));
        updatePayload.tips = tips.trim() || undefined;
        updatePayload.shop = undefined;
        updatePayload.shopAddress = undefined;
      } else {
        updatePayload.shop = shop.trim();
        updatePayload.shopAddress = shopAddress.trim() || undefined;
        updatePayload.ingredients = undefined;
        updatePayload.steps = undefined;
        updatePayload.tips = undefined;
      }
      await updateMenuItem(initialData.id, updatePayload);
    } else {
      const newItem: Omit<MenuItem, "spaceId" | "profileId" | "syncStatus" | "version"> & { id: string } = {
        ...base,
        id: uuidv4(),
        createdAt: now,
      };
      if (kind === "recipe") {
        newItem.ingredients = ingredients
          .filter((i) => i.name.trim())
          .map((i) => ({ name: i.name.trim(), amount: i.amount.trim() || undefined }));
        newItem.steps = steps
          .filter((s) => s.description.trim())
          .map((s, idx) => ({
            order: idx + 1,
            description: s.description.trim(),
            durationMinutes: s.durationMinutes,
          }));
        newItem.tips = tips.trim() || undefined;
      } else {
        newItem.shop = shop.trim();
        newItem.shopAddress = shopAddress.trim() || undefined;
      }
      await createMenuItem(newItem);
    }

    localStorage.removeItem(draftKey);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={isEdit ? "编辑菜单项" : "新增菜单项"}
      footer={
        <>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            保存
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {recentEditWarning && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
            {recentEditWarning}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Kind selector */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setKind("recipe")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-4 transition ${
              kind === "recipe"
                ? "border-primary bg-primary/5 text-primary"
                : "hover:bg-muted"
            }`}
          >
            <ChefHat className="w-5 h-5" />
            <span className="font-medium">菜谱</span>
          </button>
          <button
            type="button"
            onClick={() => setKind("takeout")}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl border p-4 transition ${
              kind === "takeout"
                ? "border-primary bg-primary/5 text-primary"
                : "hover:bg-muted"
            }`}
          >
            <Bike className="w-5 h-5" />
            <span className="font-medium">外卖</span>
          </button>
        </div>

        {/* Base fields */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              名称 {kind === "takeout" && <span className="text-muted-foreground font-normal">（如：香辣鸡腿堡）</span>}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "recipe" ? "菜谱名称" : "菜品名称"}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {kind === "takeout" && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">店铺名称</label>
                <input
                  value={shop}
                  onChange={(e) => setShop(e.target.value)}
                  placeholder="如：肯德基"
                  list="shop-history-list"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <datalist id="shop-history-list">
                  {shopHistory.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  店铺地址 <span className="text-muted-foreground font-normal">（可选）</span>
                </label>
                <input
                  value={shopAddress}
                  onChange={(e) => setShopAddress(e.target.value)}
                  placeholder="如：xx 路 xx 号"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              权重 <span className="text-muted-foreground font-normal">（越大被抽中概率越高）</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-8 text-center text-sm font-medium">{weight}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">标签</label>
            <div className="space-y-2">
              {(["cuisine", "category", "custom"] as TagType[]).map((type) => (
                <div key={type} className="flex flex-wrap gap-2">
                  {groupedTags[type].length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground py-1 w-full sm:w-auto sm:mr-2">
                        {typeLabels[type]}
                      </span>
                      {groupedTags[type].map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={`rounded-full border px-2.5 py-1 text-xs transition ${
                              active
                                ? typeColors[type] + " opacity-100"
                                : "bg-background text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {active ? "✓ " : ""}
                            {tag.name}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recipe fields */}
        {kind === "recipe" && (
          <div className="space-y-4 border-t pt-4">
            <div>
              <label className="block text-sm font-medium mb-2">菜谱图片</label>
              <ImageUploader value={imageUrl} onChange={setImageUrl} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">材料清单</label>
                <button
                  type="button"
                  onClick={handleAddIngredient}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加材料
                </button>
              </div>
              <div className="space-y-2">
                {ingredients.map((ing, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border bg-muted/30 p-3 overflow-hidden">
                    <input
                      value={ing.name}
                      onChange={(e) => handleUpdateIngredient(idx, "name", e.target.value)}
                      placeholder="材料"
                      className="w-full sm:flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="flex gap-2 justify-end">
                      <input
                        value={ing.amount}
                        onChange={(e) => handleUpdateIngredient(idx, "amount", e.target.value)}
                        placeholder="用量"
                        className="w-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveIngredient(idx)}
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {ingredients.length === 0 && (
                  <p className="text-sm text-muted-foreground">还没有添加材料</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">步骤</label>
                <button
                  type="button"
                  onClick={handleAddStep}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加步骤
                </button>
              </div>
              <div className="space-y-2">
                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    draggable
                    onDragStart={handleDragStart(idx)}
                    onDragOver={handleDragOver(idx)}
                    onDrop={handleDrop(idx)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex flex-col sm:flex-row sm:items-start gap-2 rounded-xl border bg-muted/30 p-3 transition overflow-hidden",
                      draggedIdx === idx && "opacity-50 bg-muted",
                      dragOverIdx === idx && draggedIdx !== idx && "bg-primary/10 border-primary"
                    )}
                  >
                    <div className="flex gap-2 items-start w-full">
                      <span className="mt-2.5 w-6 text-xs text-muted-foreground text-center cursor-move select-none shrink-0">
                        {idx + 1}
                      </span>
                      <textarea
                        value={step.description}
                        onChange={(e) => handleUpdateStep(idx, "description", e.target.value)}
                        placeholder={`步骤 ${idx + 1}`}
                        rows={2}
                        className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <input
                        type="number"
                        value={step.durationMinutes ?? ""}
                        onChange={(e) => handleUpdateStep(idx, "durationMinutes", e.target.value)}
                        placeholder="分钟"
                        className="w-20 rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          className="rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === steps.length - 1}
                          className="rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(idx)}
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">还没有添加步骤</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                心得 / 小贴士 <span className="text-muted-foreground font-normal">（可选）</span>
              </label>
              <textarea
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                placeholder="记录一些烹饪心得…"
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
