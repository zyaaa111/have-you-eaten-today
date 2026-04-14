"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { ComboTemplate, ComboRule, Tag, TagType } from "@/lib/types";
import { ComboTemplateFormDialog } from "@/components/combo-template-form-dialog";
import { deleteComboTemplate, createComboTemplate } from "@/lib/space-ops";
import { syncEngine } from "@/lib/sync-engine";
import { Plus, Pencil, Trash2, Dices, Copy, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";
import Link from "next/link";
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

function formatRuleSummary(rule: ComboRule, tagMap: Map<string, Tag>): string {
  const parts: string[] = [];
  parts.push(`${rule.count}×`);
  if (rule.kind) {
    parts.push(rule.kind === "recipe" ? "菜谱" : "外卖");
  }
  if (rule.tagIds && rule.tagIds.length > 0) {
    const names = rule.tagIds.map((id) => tagMap.get(id)?.name).filter(Boolean) as string[];
    if (names.length > 0) {
      parts.push(names.join("·"));
    }
  }
  if (parts.length === 1) {
    parts.push("全部");
  }
  return parts.join("");
}

export default function TemplatesPage() {
  const templates = useLiveQuery(() => db.comboTemplates.toArray(), []) || [];
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];

  const [formOpen, setFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ComboTemplate | undefined>(undefined);

  const tagMap = useMemo(() => {
    const map = new Map<string, Tag>();
    allTags.forEach((t) => map.set(t.id, t));
    return map;
  }, [allTags]);

  const groupedTags = useMemo(() => {
    const g: Record<TagType, Tag[]> = { cuisine: [], category: [], custom: [] };
    allTags.forEach((t) => g[t.type].push(t));
    return g;
  }, [allTags]);

  const handleAdd = () => {
    setEditingTemplate(undefined);
    setFormOpen(true);
  };

  const handleEdit = (t: ComboTemplate) => {
    setEditingTemplate(t);
    setFormOpen(true);
  };

  const handleDelete = async (t: ComboTemplate) => {
    const ok = confirm(`确定删除组合模板「${t.name}」吗？`);
    if (!ok) return;
    await deleteComboTemplate(t.id);
  };

  const handleDuplicate = async (t: ComboTemplate) => {
    const newTemplate: ComboTemplate = {
      ...t,
      id: uuidv4(),
      name: `${t.name} 副本`,
      isBuiltin: false,
      createdAt: Date.now(),
    };
    await createComboTemplate(newTemplate);
    setEditingTemplate(newTemplate);
    setFormOpen(true);
  };

  useEffect(() => {
    const pullChangesSafely = async () => {
      try {
        await syncEngine.pullChanges();
      } catch (error) {
        console.error("Templates page sync pull failed:", error);
      }
    };

    const sub = syncEngine.subscribeToChanges(() => {
      void pullChangesSafely();
    });
    void pullChangesSafely();
    return () => sub.unsubscribe();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">组合模板</h2>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          新增模板
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">还没有组合模板</p>
          <button
            onClick={handleAdd}
            className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            创建一个
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => {
            const totalCount = t.rules.reduce((s, r) => s + r.count, 0);
            return (
              <div
                key={t.id}
                className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium line-clamp-1">{t.name}</div>
                  {t.isBuiltin && (
                    <span className="shrink-0 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      内置
                    </span>
                  )}
                </div>

                <div className="text-sm text-muted-foreground">
                  {t.rules.map((r, i) => (
                    <span key={i}>
                      {formatRuleSummary(r, tagMap)}
                      {i < t.rules.length - 1 ? " + " : ""}
                    </span>
                  ))}
                </div>

                <div className="text-xs text-muted-foreground">
                  {t.rules.length} 条规则 · 共 {totalCount} 项
                </div>

                <div className="flex items-center gap-2 pt-2 border-t">
                  <Link
                    href={`/random?templateId=${t.id}`}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Dices className="w-4 h-4" />
                    试用
                  </Link>
                  {t.isBuiltin ? (
                    <button
                      onClick={() => handleDuplicate(t)}
                      className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                      title="复制为自定义模板"
                    >
                      <Copy className="w-4 h-4" />
                      复制
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEdit(t)}
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                        title="编辑"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ComboTemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialData={editingTemplate}
        allTags={allTags}
        onSaved={() => {
          // liveQuery auto refreshes
        }}
      />
    </div>
  );
}
