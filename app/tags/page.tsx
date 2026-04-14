"use client";

import { useState, useMemo } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { Tag, TagType } from "@/lib/types";
import { createTag, updateTag, deleteTag, updateMenuItem } from "@/lib/space-ops";
import { syncEngine } from "@/lib/sync-engine";
import { v4 as uuidv4 } from "uuid";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
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

export default function TagsPage() {
  const tags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<TagType>("custom");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [message, setMessage] = useState("");

  const grouped = useMemo(() => {
    const g: Record<TagType, Tag[]> = { cuisine: [], category: [], custom: [] };
    tags.forEach((t) => g[t.type].push(t));
    return g;
  }, [tags]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const existing = tags.find(
      (t) => t.name === name && t.type === newType
    );
    if (existing) {
      showMessage(`标签「${existing.name}」已存在，将直接使用`);
      setNewName("");
      setNewType("custom");
      setIsAdding(false);
      return;
    }
    await createTag({
      id: uuidv4(),
      name,
      type: newType,
      createdAt: Date.now(),
    });
    setNewName("");
    setNewType("custom");
    setIsAdding(false);
    showMessage("标签已添加");
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleEditSave = async (tag: Tag) => {
    const name = editName.trim();
    if (!name || name === tag.name) {
      cancelEdit();
      return;
    }
    const exists = tags.some(
      (t) => t.id !== tag.id && t.name === name && t.type === tag.type
    );
    if (exists) {
      showMessage("同类型下已存在该名称");
      return;
    }
    await updateTag(tag.id, { name });
    cancelEdit();
    showMessage("标签已更新");
  };

  const handleDelete = async (tag: Tag) => {
    const usedCount = await db.menuItems.where("tags").anyOf(tag.id).count();
    if (usedCount > 0) {
      const ok = confirm(
        `「${tag.name}」正被 ${usedCount} 个菜单项使用，删除后会从这些菜单项中移除该标签。确定删除吗？`
      );
      if (!ok) return;
      // 从所有引用的 menuItems 中移除该 tag id
      const items = await db.menuItems.where("tags").anyOf(tag.id).toArray();
      await db.transaction("rw", db.menuItems, async () => {
        for (const item of items) {
          await updateMenuItem(item.id, {
            tags: item.tags.filter((tid) => tid !== tag.id),
            updatedAt: Date.now(),
          });
        }
      });
    } else {
      const ok = confirm(`确定删除标签「${tag.name}」吗？`);
      if (!ok) return;
    }
    await deleteTag(tag.id);
    showMessage("标签已删除");
  };

  useEffect(() => {
    const sub = syncEngine.subscribeToChanges(() => {
      syncEngine.pullChanges();
    });
    syncEngine.pullChanges();
    return () => sub.unsubscribe();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">标签管理</h2>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            新增标签
          </button>
        )}
      </div>

      {isAdding && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="标签名称"
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as TagType)}
              className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="cuisine">菜系</option>
              <option value="category">类别</option>
              <option value="custom">自定义</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Check className="w-4 h-4" />
                保存
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewName("");
                }}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <X className="w-4 h-4" />
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-md bg-muted p-3 text-sm text-foreground">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["cuisine", "category", "custom"] as TagType[]).map((type) => (
          <section
            key={type}
            className="rounded-xl border bg-card p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${typeColors[type]}`}
              >
                {typeLabels[type]}
              </span>
              <span className="text-sm text-muted-foreground">
                共 {grouped[type].length} 个
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {grouped[type].length === 0 && (
                <span className="text-sm text-muted-foreground">
                  暂无标签
                </span>
              )}
              {grouped[type].map((tag) => (
                <div
                  key={tag.id}
                  className={`group inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${typeColors[type]}`}
                >
                  {editingId === tag.id ? (
                    <>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-24 rounded bg-white/70 px-1 py-0.5 text-sm outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleEditSave(tag);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        onClick={() => handleEditSave(tag)}
                        className="p-0.5 hover:bg-black/5 rounded"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-0.5 hover:bg-black/5 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span>{tag.name}</span>
                      <button
                        onClick={() => startEdit(tag)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/5 rounded transition-opacity"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(tag)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/5 rounded transition-opacity"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
