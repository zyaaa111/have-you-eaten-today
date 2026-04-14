import { db } from "./db";
import type { MenuItem, Tag, ComboTemplate, ChangeLog } from "./types";
import type { SyncService, SyncPayload, SyncResult, SyncStatus as SyncServiceStatus } from "./sync-service";
import { getLocalIdentity } from "./supabase";
import { buildApiUrl } from "./api-base";
import { sanitizeMenuItemRecord, sanitizeMenuItemSnapshot } from "./menu-item-sanitize";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    const isHtml = text.trim().startsWith("<") || text.includes("<!DOCTYPE");
    if (res.status === 404 && isHtml) {
      throw new Error(
        `HTTP 404: 服务端 API 不存在 (${url})。请确认 NEXT_PUBLIC_API_BASE_URL 指向 /api（修改后需重新构建），并检查服务器已部署 app/api 路由。`
      );
    }
    const preview = text.length > 300 ? text.slice(0, 300) + "..." : text;
    throw new Error(`HTTP ${res.status}: ${preview}`);
  }
  return res.json() as Promise<T>;
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const sk = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[sk] = v;
  }
  return out;
}

export class HttpSyncEngine implements SyncService {
  async pushChanges(_payload?: SyncPayload): Promise<SyncResult> {
    const identity = getLocalIdentity();
    if (!identity) {
      return { success: false, error: "未加入任何空间" };
    }
    const spaceId = identity.space.id;
    const profileId = identity.profile.id;

    const conflicts: string[] = [];

    // 1. Pending deletions
    const pendingDeletions = await db.pendingDeletions.where({ spaceId }).toArray();
    const deletionsByTable: Record<string, string[]> = {};
    for (const del of pendingDeletions) {
      const tableMap: Record<string, string> = {
        menu_items: "menu-items",
        tags: "tags",
        combo_templates: "combo-templates",
      };
      const path = tableMap[del.tableName];
      if (!path) continue;
      if (!deletionsByTable[path]) deletionsByTable[path] = [];
      deletionsByTable[path].push(del.recordId);
    }

    for (const [path, ids] of Object.entries(deletionsByTable)) {
      try {
        await api(`/sync/${path}/delete`, {
          method: "POST",
          body: JSON.stringify({ ids, space_id: spaceId }),
        });
        for (const id of ids) {
          await db.pendingDeletions.where({ tableName: mapPathToTableName(path), recordId: id }).delete();
        }
      } catch (e) {
        console.error("Delete sync failed:", e);
      }
    }

    // 2. Pending menu items
    const pendingMenuItems = await db.menuItems.where({ spaceId }).and((x) => x.syncStatus === "pending").toArray();
    if (pendingMenuItems.length > 0) {
      try {
        const payload = pendingMenuItems.map((item) =>
          toSnake({
            id: item.id,
            space_id: spaceId,
            profile_id: profileId,
            kind: item.kind,
            name: item.name,
            tags: item.tags,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
            ingredients: item.ingredients,
            steps: item.steps,
            tips: item.tips,
            shop: item.shop,
            shop_address: item.shopAddress,
            image_url: item.imageUrl,
            version: item.version ?? 1,
          })
        );
        payload.forEach((p: Record<string, unknown>, idx: number) => {
          const hasImage = !!p.image_url;
          const size = JSON.stringify(p).length;
          console.log(`[Sync Push] menu_item[${idx}] id=${p.id} hasImage=${hasImage} size=${size}`);
        });
        await api("/sync/menu-items", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        for (const item of pendingMenuItems) {
          await db.menuItems.update(item.id, { syncStatus: "synced" });
        }
      } catch (e) {
        console.error("Menu items sync failed:", e);
        conflicts.push(...pendingMenuItems.map((i) => `menu_item:${i.id}`));
      }
    }

    // 3. Pending tags
    const pendingTags = await db.tags.where({ spaceId }).and((x) => x.syncStatus === "pending").toArray();
    if (pendingTags.length > 0) {
      try {
        await api("/sync/tags", {
          method: "POST",
          body: JSON.stringify(
            pendingTags.map((item) =>
              toSnake({
                id: item.id,
                space_id: spaceId,
                profile_id: profileId,
                name: item.name,
                type: item.type,
                created_at: item.createdAt,
                updated_at: item.updatedAt,
                version: item.version ?? 1,
              })
            )
          ),
        });
        for (const item of pendingTags) {
          await db.tags.update(item.id, { syncStatus: "synced" });
        }
      } catch (e) {
        console.error("Tags sync failed:", e);
        conflicts.push(...pendingTags.map((i) => `tag:${i.id}`));
      }
    }

    // 4. Pending combo templates
    const pendingTemplates = await db.comboTemplates
      .where({ spaceId })
      .and((x) => x.syncStatus === "pending")
      .toArray();
    if (pendingTemplates.length > 0) {
      try {
        await api("/sync/combo-templates", {
          method: "POST",
          body: JSON.stringify(
            pendingTemplates.map((item) =>
              toSnake({
                id: item.id,
                space_id: spaceId,
                profile_id: profileId,
                name: item.name,
                rules: item.rules,
                is_builtin: item.isBuiltin ? 1 : 0,
                created_at: item.createdAt,
                updated_at: item.updatedAt,
                version: item.version ?? 1,
              })
            )
          ),
        });
        for (const item of pendingTemplates) {
          await db.comboTemplates.update(item.id, { syncStatus: "synced" });
        }
      } catch (e) {
        console.error("Combo templates sync failed:", e);
        conflicts.push(...pendingTemplates.map((i) => `combo_template:${i.id}`));
      }
    }

    if (conflicts.length > 0) {
      return { success: false, error: `部分记录同步冲突: ${conflicts.join(", ")}` };
    }
    return { success: true };
  }

  async pullChanges(): Promise<Partial<SyncPayload>> {
    const identity = getLocalIdentity();
    if (!identity) {
      return {};
    }
    const spaceId = identity.space.id;

    const [menuItems, tags, comboTemplates] = await Promise.all([
      api<MenuItem[]>(`/sync/menu-items?space_id=${encodeURIComponent(spaceId)}`),
      api<Tag[]>(`/sync/tags?space_id=${encodeURIComponent(spaceId)}`),
      api<ComboTemplate[]>(`/sync/combo-templates?space_id=${encodeURIComponent(spaceId)}`),
    ]);
    const sanitizedMenuItems = menuItems.map(
      (item) => sanitizeMenuItemRecord(item as unknown as Record<string, unknown>) as unknown as MenuItem
    );

    await db.transaction("rw", db.menuItems, db.tags, db.comboTemplates, db.tagMappings, async () => {
      // 1. Clear old tag mappings for this space
      await db.tagMappings.where({ spaceId }).delete();
      const tagMappingMap = new Map<string, string>();

      // 2. Process tags first so menuItems can reference them
      for (const remote of tags) {
        const local = await db.tags.get(remote.id);
        if (local) {
          if (local.syncStatus !== "pending" && local.syncStatus !== "conflict") {
            if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
              await db.tags.put({ ...remote, syncStatus: "synced" });
            }
          }
        } else {
          const existing = await db.tags.where("name").equals(remote.name).and((t) => t.type === remote.type).first();
          if (existing) {
            await db.tagMappings.add({ spaceId, aliasId: remote.id, canonicalId: existing.id });
            tagMappingMap.set(remote.id, existing.id);
          } else {
            await db.tags.add({ ...remote, syncStatus: "synced" });
          }
        }
      }

      // 3. Process menuItems with tag mapping and union merge
      for (const remote of sanitizedMenuItems) {
        const local = await db.menuItems.get(remote.id);
        const resolvedRemoteTags = resolveTagIds(remote.tags, tagMappingMap);
        if (!local) {
          await db.menuItems.add({ ...remote, tags: resolvedRemoteTags, syncStatus: "synced" });
        } else if (local.syncStatus !== "pending" && local.syncStatus !== "conflict") {
          if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
            const mergedTags = Array.from(new Set([...resolvedRemoteTags, ...(local.tags || [])]));
            await db.menuItems.put({ ...remote, tags: mergedTags, syncStatus: "synced" });
          }
        }
      }

      // 4. Process comboTemplates with tag mapping
      for (const remote of comboTemplates) {
        const local = await db.comboTemplates.get(remote.id);
        const resolvedRules = resolveComboRules(remote.rules, tagMappingMap);
        if (!local) {
          await db.comboTemplates.add({ ...remote, rules: resolvedRules, syncStatus: "synced" });
        } else if (local.syncStatus !== "pending" && local.syncStatus !== "conflict") {
          if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
            await db.comboTemplates.put({ ...remote, rules: resolvedRules, syncStatus: "synced" });
          }
        }
      }
    });

    return { menuItems: sanitizedMenuItems, tags, comboTemplates };
  }

  async getSyncStatus(): Promise<SyncServiceStatus> {
    const identity = getLocalIdentity();
    if (!identity) {
      return { pendingCount: 0, lastSyncedAt: undefined };
    }
    const spaceId = identity.space.id;
    const [pendingMenu, pendingTags, pendingTemplates, pendingDel] = await Promise.all([
      db.menuItems.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.tags.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.comboTemplates.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.pendingDeletions.where({ spaceId }).count(),
    ]);
    const pendingCount = pendingMenu + pendingTags + pendingTemplates + pendingDel;
    return { pendingCount, lastSyncedAt: Date.now() };
  }

  async fetchChangeLogs(limit = 50): Promise<ChangeLog[]> {
    const identity = getLocalIdentity();
    if (!identity) return [];
    const logs = await api<ChangeLog[]>(
      `/changelog?space_id=${encodeURIComponent(identity.space.id)}&limit=${limit}`
    );
    return sanitizeChangeLogs(logs);
  }

  async fetchChangeLogsForRecord(
    tableName: ChangeLog["tableName"],
    recordId: string
  ): Promise<ChangeLog[]> {
    const identity = getLocalIdentity();
    if (!identity) return [];
    const logs = await api<ChangeLog[]>(
      `/changelog/record?space_id=${encodeURIComponent(identity.space.id)}&table_name=${encodeURIComponent(
        tableName
      )}&record_id=${encodeURIComponent(recordId)}`
    );
    return sanitizeChangeLogs(logs);
  }

  subscribeToChanges(callback: () => void): { unsubscribe: () => void } {
    const interval = setInterval(() => {
      callback();
    }, 3000);
    return {
      unsubscribe: () => clearInterval(interval),
    };
  }
}

function mapPathToTableName(path: string): "menu_items" | "tags" | "combo_templates" {
  if (path === "menu-items") return "menu_items";
  if (path === "tags") return "tags";
  return "combo_templates";
}

function resolveTagIds(tagIds: string[] | undefined, mappings: Map<string, string>): string[] {
  if (!Array.isArray(tagIds)) return [];
  return Array.from(new Set(tagIds.map((id) => mappings.get(id) || id)));
}

function resolveComboRules(rules: ComboTemplate["rules"] | undefined, mappings: Map<string, string>): ComboTemplate["rules"] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule) => ({
    ...rule,
    tagIds: rule.tagIds ? resolveTagIds(rule.tagIds, mappings) : rule.tagIds,
  }));
}

function sanitizeChangeLogs(logs: ChangeLog[]): ChangeLog[] {
  return logs.map((log) => {
    if (log.tableName !== "menu_items") return log;
    return {
      ...log,
      beforeSnapshot: sanitizeMenuItemSnapshot(log.beforeSnapshot ?? null),
      afterSnapshot: sanitizeMenuItemSnapshot(log.afterSnapshot ?? null),
    };
  });
}

export const syncEngine = new HttpSyncEngine();
