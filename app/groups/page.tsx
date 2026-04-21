"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import {
  addMenuItemToGroup,
  createMenuGroup,
  deleteMenuGroup,
  moveMenuGroupItem,
  removeMenuItemFromGroup,
  renameMenuGroup,
} from "@/lib/groups";
import { FolderOpen, Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { getLocalIdentity } from "@/lib/identity";
import { useAuth } from "@/components/auth-provider";

export default function GroupsPage() {
  const { user } = useAuth();
  const [identity, setIdentity] = useState<ReturnType<typeof getLocalIdentity>>(null);
  const groups = useLiveQuery(() => db.menuGroups.orderBy("sortOrder").toArray(), []) || [];
  const groupItems = useLiveQuery(() => db.menuGroupItems.toArray(), []) || [];
  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  useEffect(() => {
    setIdentity(getLocalIdentity());
  }, [user?.id]);

  const visibleGroups = useMemo(
    () =>
      groups.filter((group) =>
        identity
          ? group.scope === "profile" && group.profileId === identity.profile.id && group.spaceId === identity.space.id
          : group.scope === "local"
      ),
    [groups, identity]
  );
  const visibleGroupItems = useMemo(
    () =>
      groupItems.filter((item) =>
        identity
          ? item.profileId === identity.profile.id && item.spaceId === identity.space.id
          : !item.profileId && !item.spaceId
      ),
    [groupItems, identity]
  );

  useEffect(() => {
    if (!selectedGroupId && visibleGroups.length > 0) {
      setSelectedGroupId(visibleGroups[0].id);
    }
    if (selectedGroupId && !visibleGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(visibleGroups[0]?.id ?? null);
    }
  }, [selectedGroupId, visibleGroups]);

  const selectedGroup = visibleGroups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedGroupItems = useMemo(() => {
    if (!selectedGroupId) return [];
    const ids = visibleGroupItems
      .filter((item) => item.groupId === selectedGroupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.menuItemId);
    return ids
      .map((menuItemId) => menuItems.find((item) => item.id === menuItemId))
      .filter(Boolean);
  }, [menuItems, selectedGroupId, visibleGroupItems]);

  const selectedMenuItemIds = new Set(
    visibleGroupItems.filter((item) => item.groupId === selectedGroupId).map((item) => item.menuItemId)
  );
  const availableItems = menuItems.filter((item) => !selectedMenuItemIds.has(item.id));

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const group = await createMenuGroup(name);
    setNewGroupName("");
    setSelectedGroupId(group.id);
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    const confirmed = confirm(`确定删除场景清单「${groupName}」吗？`);
    if (!confirmed) return;
    await deleteMenuGroup(groupId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">场景清单</h2>
          <p className="text-sm text-muted-foreground">把常见搭配整理成清单，之后可以直接筛选或随机。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        <aside className="rounded-xl border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">新建清单</div>
            <div className="flex gap-2">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="例如：工作日晚餐"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={handleCreateGroup}
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
                {visibleGroups.length === 0 ? (
              <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                还没有场景清单。
              </div>
            ) : (
              visibleGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedGroupId === group.id
                      ? "border-primary bg-primary/5"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{group.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {group.scope === "profile" ? "当前空间私有清单" : "本地清单"}
                      </div>
                    </div>
                    <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="rounded-xl border bg-card p-5 space-y-4">
          {selectedGroup ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {selectedGroup.scope === "profile" ? "当前空间私有清单" : "本地清单"}
                  </div>
                  {editingGroupId === selectedGroup.id ? (
                    <div className="flex gap-2 mt-1">
                      <input
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        className="rounded-md border bg-background px-3 py-2 text-sm"
                      />
                      <button
                        onClick={async () => {
                          await renameMenuGroup(selectedGroup.id, editingGroupName);
                          setEditingGroupId(null);
                          setEditingGroupName("");
                        }}
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    <h3 className="text-lg font-semibold">{selectedGroup.name}</h3>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setEditingGroupId(selectedGroup.id);
                      setEditingGroupName(selectedGroup.name);
                    }}
                    className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <Pencil className="w-4 h-4 mr-1" />
                    重命名
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(selectedGroup.id, selectedGroup.name)}
                    className="inline-flex items-center justify-center rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    删除
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <div className="text-sm font-medium">清单内菜单</div>
                  {selectedGroupItems.length === 0 ? (
                    <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                      还没有菜单，先从右侧加入。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedGroupItems.map((item) => {
                        if (!item) return null;
                        return (
                          <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-3">
                            <div>
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.kind === "recipe" ? "菜谱" : item.shop || "外卖"}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => moveMenuGroupItem(selectedGroup.id, item.id, -1)}
                                className="rounded-md border bg-background px-2 py-2 hover:bg-muted"
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => moveMenuGroupItem(selectedGroup.id, item.id, 1)}
                                className="rounded-md border bg-background px-2 py-2 hover:bg-muted"
                              >
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeMenuItemFromGroup(selectedGroup.id, item.id)}
                                className="rounded-md border border-destructive px-2 py-2 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium">可加入的菜单</div>
                  {availableItems.length === 0 ? (
                    <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                      所有菜单都已加入当前清单。
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                      {availableItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-3">
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.kind === "recipe" ? "菜谱" : item.shop || "外卖"}
                            </div>
                          </div>
                          <button
                            onClick={() => addMenuItemToGroup(selectedGroup.id, item.id)}
                            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            加入
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
              先创建一个场景清单。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
