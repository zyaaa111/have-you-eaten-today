"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { ComboTemplate, ComboRule, Tag, TagType, MenuItemKind } from "@/lib/types";
import { createComboTemplate, updateComboTemplate } from "@/lib/space-ops";
import { v4 as uuidv4 } from "uuid";
import { Plus, Trash2, ArrowUp, ArrowDown, Dices, Copy } from "lucide-react";

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

interface ComboTemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: ComboTemplate;
  allTags: Tag[];
  onSaved?: () => void;
}

function createEmptyRule(): ComboRule {
  return { count: 1 };
}

export function ComboTemplateFormDialog({
  open,
  onOpenChange,
  initialData,
  allTags,
  onSaved,
}: ComboTemplateFormDialogProps) {
  const isEdit = Boolean(initialData);
  const [name, setName] = useState("");
  const [rules, setRules] = useState<ComboRule[]>([createEmptyRule()]);
  const [error, setError] = useState("");

  const groupedTags = useMemo(() => {
    const g: Record<TagType, Tag[]> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((t) => g[t.type].push(t));
    return g;
  }, [allTags]);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setName(initialData.name);
        setRules(initialData.rules.length > 0 ? initialData.rules.map((r) => ({ ...r })) : [createEmptyRule()]);
      } else {
        setName("");
        setRules([createEmptyRule()]);
      }
      setError("");
    }
  }, [open, initialData]);

  const handleAddRule = () => {
    setRules((prev) => [...prev, createEmptyRule()]);
  };

  const handleRemoveRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveRule = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= rules.length) return;
    setRules((prev) => {
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const updateRule = (idx: number, patch: Partial<ComboRule>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const toggleRuleTag = (ruleIdx: number, tagId: string) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const ids = r.tagIds || [];
        return {
          ...r,
          tagIds: ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId],
        };
      })
    );
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入模板名称");
      return;
    }
    if (rules.length === 0) {
      setError("至少需要一条规则");
      return;
    }
    for (const r of rules) {
      if (!r.count || r.count < 1) {
        setError("每条规则的数量至少为 1");
        return;
      }
    }

    const cleanedRules: ComboRule[] = rules.map((r) => ({
      count: r.count,
      kind: r.kind || undefined,
      tagIds: r.tagIds && r.tagIds.length > 0 ? r.tagIds : undefined,
      shop: r.shop || undefined,
    }));

    if (isEdit && initialData) {
      await updateComboTemplate(initialData.id, {
        name: trimmedName,
        rules: cleanedRules,
      });
    } else {
      const newTemplate: Omit<ComboTemplate, "spaceId" | "profileId" | "syncStatus" | "version"> = {
        id: uuidv4(),
        name: trimmedName,
        rules: cleanedRules,
        isBuiltin: false,
        createdAt: Date.now(),
      };
      await createComboTemplate(newTemplate);
    }

    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={isEdit ? "编辑组合模板" : "新增组合模板"}
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
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">模板名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：1主食 + 1荤菜 + 1素菜"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">规则列表</label>
            <button
              type="button"
              onClick={handleAddRule}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              <Plus className="w-3.5 h-3.5" />
              添加规则
            </button>
          </div>

          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <div key={idx} className="rounded-xl border bg-muted/40 p-3 md:p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-12">规则 {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={rule.count}
                      onChange={(e) => updateRule(idx, { count: Number(e.target.value) })}
                      className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <span className="text-sm text-muted-foreground">个</span>
                  </div>
                  <select
                    value={rule.kind || ""}
                    onChange={(e) =>
                      updateRule(idx, { kind: (e.target.value as MenuItemKind) || undefined })
                    }
                    className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">全部类型</option>
                    <option value="recipe">菜谱</option>
                    <option value="takeout">外卖</option>
                  </select>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveRule(idx, -1)}
                      disabled={idx === 0}
                      className="rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveRule(idx, 1)}
                      disabled={idx === rules.length - 1}
                      className="rounded-md border px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRule(idx)}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {(["cuisine", "category", "custom"] as TagType[]).map((type) =>
                    groupedTags[type].length > 0 ? (
                      <div key={type} className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-muted-foreground w-10">{typeLabels[type]}</span>
                        {groupedTags[type].map((tag) => {
                          const active = (rule.tagIds || []).includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleRuleTag(idx, tag.id)}
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
            ))}
            {rules.length === 0 && (
              <p className="text-sm text-muted-foreground">还没有添加规则</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
