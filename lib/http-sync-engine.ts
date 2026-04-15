import { db } from "./db";
import type { MenuItem, Tag, ComboTemplate, Like, Comment, ChangeLog, Profile } from "./types";
import type { SyncService, SyncPayload, SyncResult, SyncStatus as SyncServiceStatus } from "./sync-service";
import { getLocalIdentity } from "./supabase";
import { buildApiUrl } from "./api-base";
import { sanitizeMenuItemRecord, sanitizeMenuItemSnapshot } from "./menu-item-sanitize";
import { buildLikeId, isDeterministicLikeId } from "./like-id";

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

interface DeleteResponse {
  success?: boolean;
  deleted?: number;
  deletedIds?: string[];
  missingIds?: string[];
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
        likes: "likes",
        comments: "comments",
      };
      const path = tableMap[del.tableName];
      if (!path) continue;
      if (!deletionsByTable[path]) deletionsByTable[path] = [];
      deletionsByTable[path].push(del.recordId);
    }

    for (const [path, ids] of Object.entries(deletionsByTable)) {
      try {
        const response = await api<DeleteResponse>(`/sync/${path}/delete`, {
          method: "POST",
          body: JSON.stringify({ ids, space_id: spaceId }),
        });
        const clearedIds = new Set(response.deletedIds ?? []);
        if (path === "likes") {
          for (const id of response.missingIds ?? []) {
            if (isDeterministicLikeId(id)) {
              clearedIds.add(id);
            }
          }
        } else {
          for (const id of response.missingIds ?? []) {
            clearedIds.add(id);
          }
        }

        for (const id of Array.from(clearedIds)) {
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

    // 5. Pending likes
    const pendingLikes = await db.likes
      .where({ spaceId })
      .and((x) => x.syncStatus === "pending")
      .toArray();
    if (pendingLikes.length > 0) {
      try {
        await api("/sync/likes", {
          method: "POST",
          body: JSON.stringify(
            pendingLikes.map((item) =>
              toSnake({
                id: item.id,
                menu_item_id: item.menuItemId,
                profile_id: item.profileId,
                space_id: spaceId,
                created_at: item.createdAt,
              })
            )
          ),
        });
        for (const item of pendingLikes) {
          await db.likes.update(item.id, { syncStatus: "synced" });
        }
      } catch (e) {
        console.error("Likes sync failed:", e);
        conflicts.push(...pendingLikes.map((i) => `like:${i.id}`));
      }
    }

    // 6. Pending comments
    const pendingComments = await db.comments
      .where({ spaceId })
      .and((x) => x.syncStatus === "pending")
      .toArray();
    if (pendingComments.length > 0) {
      try {
        await api("/sync/comments", {
          method: "POST",
          body: JSON.stringify(
            pendingComments.map((item) =>
              toSnake({
                id: item.id,
                menu_item_id: item.menuItemId,
                profile_id: item.profileId,
                space_id: spaceId,
                nickname: item.nickname,
                content: item.content,
                is_anonymous: item.isAnonymous ? 1 : 0,
                created_at: item.createdAt,
                updated_at: item.updatedAt,
                version: item.version ?? 1,
              })
            )
          ),
        });
        for (const item of pendingComments) {
          await db.comments.update(item.id, { syncStatus: "synced" });
        }
      } catch (e) {
        console.error("Comments sync failed:", e);
        conflicts.push(...pendingComments.map((i) => `comment:${i.id}`));
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

    const [menuItems, tags, comboTemplates, likes, comments] = await Promise.all([
      api<MenuItem[]>(`/sync/menu-items?space_id=${encodeURIComponent(spaceId)}`),
      api<Tag[]>(`/sync/tags?space_id=${encodeURIComponent(spaceId)}`),
      api<ComboTemplate[]>(`/sync/combo-templates?space_id=${encodeURIComponent(spaceId)}`),
      api<Like[]>(`/sync/likes?space_id=${encodeURIComponent(spaceId)}`),
      api<Comment[]>(`/sync/comments?space_id=${encodeURIComponent(spaceId)}`),
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

    // 5. Process likes (unique by menuItemId + profileId)
    for (const remote of likes) {
      const normalizedRemote = remote.spaceId
        ? { ...remote, id: buildLikeId(remote.spaceId, remote.menuItemId, remote.profileId) }
        : remote;
      const existing = await db.likes
        .where("[menuItemId+profileId]")
        .equals([normalizedRemote.menuItemId, normalizedRemote.profileId])
        .first();
      if (!existing) {
        await db.likes.add({ ...normalizedRemote, syncStatus: "synced" });
      } else if (existing.id !== normalizedRemote.id && existing.syncStatus !== "pending") {
        await db.likes.delete(existing.id);
        await db.likes.add({ ...normalizedRemote, syncStatus: "synced" });
      }
    }

    // Delete likes that exist locally but not remotely (and not pending)
    const remoteLikeKeys = new Set(likes.map((l) => `${l.menuItemId}:${l.profileId}`));
    const localLikes = await db.likes.where("spaceId").equals(spaceId).toArray();
    const likesToDelete = localLikes
      .filter((local) => local.syncStatus !== "pending" && !remoteLikeKeys.has(`${local.menuItemId}:${local.profileId}`))
      .map((local) => local.id);
    if (likesToDelete.length > 0) {
      await db.likes.bulkDelete(likesToDelete);
    }

    // 6. Process comments (LWW by updatedAt)
    for (const remote of comments) {
      const local = await db.comments.get(remote.id);
      if (!local) {
        await db.comments.add({ ...remote, syncStatus: "synced" });
      } else if (local.syncStatus !== "pending" && local.syncStatus !== "conflict") {
        if ((remote.updatedAt ?? remote.createdAt) > (local.updatedAt ?? local.createdAt)) {
          await db.comments.put({ ...remote, syncStatus: "synced" });
        }
      }
    }

    // Delete comments that exist locally but not remotely (and not pending)
    const remoteCommentIds = new Set(comments.map((c) => c.id));
    const localComments = await db.comments.where("spaceId").equals(spaceId).toArray();
    const commentsToDelete = localComments
      .filter((local) => local.syncStatus !== "pending" && !remoteCommentIds.has(local.id))
      .map((local) => local.id);
    if (commentsToDelete.length > 0) {
      await db.comments.bulkDelete(commentsToDelete);
    }

    return { menuItems: sanitizedMenuItems, tags, comboTemplates };
  }

  async getSyncStatus(): Promise<SyncServiceStatus> {
    const identity = getLocalIdentity();
    if (!identity) {
      return { pendingCount: 0, lastSyncedAt: undefined };
    }
    const spaceId = identity.space.id;
    const [pendingMenu, pendingTags, pendingTemplates, pendingDel, pendingLikes, pendingComments] = await Promise.all([
      db.menuItems.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.tags.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.comboTemplates.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.pendingDeletions.where({ spaceId }).count(),
      db.likes.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.comments.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
    ]);
    const pendingCount = pendingMenu + pendingTags + pendingTemplates + pendingDel + pendingLikes + pendingComments;
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

  private profilesCache: { spaceId: string; profiles: Profile[]; timestamp: number } | null = null;
  private static PROFILES_CACHE_TTL = 60_000; // 1 minute

  async fetchProfiles(spaceId?: string): Promise<Profile[]> {
    const identity = getLocalIdentity();
    const sid = spaceId ?? identity?.space.id;
    if (!sid) return [];
    const cached = this.profilesCache;
    if (cached && cached.spaceId === sid && Date.now() - cached.timestamp < HttpSyncEngine.PROFILES_CACHE_TTL) {
      return cached.profiles;
    }
    const profiles = await api<Profile[]>(`/sync/profiles?space_id=${encodeURIComponent(sid)}`);
    this.profilesCache = { spaceId: sid, profiles, timestamp: Date.now() };
    return profiles;
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

function mapPathToTableName(path: string): "menu_items" | "tags" | "combo_templates" | "likes" | "comments" {
  if (path === "menu-items") return "menu_items";
  if (path === "tags") return "tags";
  if (path === "combo-templates") return "combo_templates";
  if (path === "likes") return "likes";
  if (path === "comments") return "comments";
  throw new Error(`Unknown sync path: ${path}`);
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
