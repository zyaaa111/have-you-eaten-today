import { db } from "./db";
import type { MenuItem, Tag, ComboTemplate, Like, Comment, ChangeLog, Profile, SyncConflict } from "./types";
import type { SyncService, SyncPayload, SyncResult, SyncStatus as SyncServiceStatus } from "./sync-service";
import { getLocalIdentity } from "./identity";
import { buildApiUrl } from "./api-base";
import { sanitizeMenuItemRecord, sanitizeMenuItemSnapshot } from "./menu-item-sanitize";
import { buildLikeId, isDeterministicLikeId } from "./like-id";
import { getLocalSessionUser } from "./auth-client";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    credentials: "include",
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

interface DeltaResponse {
  cursor: number;
  serverCursor: number;
  hasMore: boolean;
  changes: {
    menuItems: MenuItem[];
    tags: Tag[];
    comboTemplates: ComboTemplate[];
    likes: Like[];
    comments: Comment[];
  };
  deleted: {
    menu_items: string[];
    tags: string[];
    combo_templates: string[];
    likes: string[];
    comments: string[];
  };
}

type VersionedRecord = {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  version?: number;
  syncStatus?: "local" | "synced" | "pending" | "conflict";
};

const SYNC_CURSOR_PREFIX = "syncCursor:";
const SYNC_CONNECTION_PREFIX = "syncConnectionStatus:";
const SYNC_LAST_EVENT_PREFIX = "syncLastEventAt:";
const SYNC_LAST_SYNC_PREFIX = "syncLastSyncedAt:";

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const sk = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[sk] = v;
  }
  return out;
}

export class HttpSyncEngine implements SyncService {
  private async getCursor(spaceId: string): Promise<number> {
    const row = await db.settings.get(`${SYNC_CURSOR_PREFIX}${spaceId}`);
    return typeof row?.value === "number" ? row.value : 0;
  }

  private async setCursor(spaceId: string, cursor: number): Promise<void> {
    await db.settings.put({ key: `${SYNC_CURSOR_PREFIX}${spaceId}`, value: cursor });
  }

  private async setConnectionStatus(
    spaceId: string,
    status: NonNullable<SyncServiceStatus["connectionStatus"]>
  ): Promise<void> {
    await db.settings.put({ key: `${SYNC_CONNECTION_PREFIX}${spaceId}`, value: status });
  }

  private async setLastEventAt(spaceId: string, ts: number): Promise<void> {
    await db.settings.put({ key: `${SYNC_LAST_EVENT_PREFIX}${spaceId}`, value: ts });
  }

  private async setLastSyncedAt(spaceId: string, ts: number): Promise<void> {
    await db.settings.put({ key: `${SYNC_LAST_SYNC_PREFIX}${spaceId}`, value: ts });
  }

  private async getConnectionMeta(spaceId: string): Promise<{
    connectionStatus: NonNullable<SyncServiceStatus["connectionStatus"]>;
    lastEventAt?: number;
    lastSyncedAt?: number;
  }> {
    const [connectionRow, lastEventRow, lastSyncRow] = await Promise.all([
      db.settings.get(`${SYNC_CONNECTION_PREFIX}${spaceId}`),
      db.settings.get(`${SYNC_LAST_EVENT_PREFIX}${spaceId}`),
      db.settings.get(`${SYNC_LAST_SYNC_PREFIX}${spaceId}`),
    ]);
    return {
      connectionStatus:
        connectionRow?.value === "streaming" || connectionRow?.value === "polling" || connectionRow?.value === "offline"
          ? connectionRow.value
          : "offline",
      lastEventAt: typeof lastEventRow?.value === "number" ? lastEventRow.value : undefined,
      lastSyncedAt: typeof lastSyncRow?.value === "number" ? lastSyncRow.value : undefined,
    };
  }

  private async fetchServerCursor(spaceId: string): Promise<number> {
    const response = await api<DeltaResponse>(
      `/sync/delta?space_id=${encodeURIComponent(spaceId)}&cursor=${Number.MAX_SAFE_INTEGER}`
    );
    return response.serverCursor;
  }

  private async recordConflict(
    spaceId: string,
    tableName: SyncConflict["tableName"],
    recordId: string,
    localSnapshot: Record<string, unknown> | null,
    remoteSnapshot: Record<string, unknown> | null,
    seq: number
  ) {
    await db.syncConflicts.put({
      id: `${spaceId}:${tableName}:${recordId}`,
      spaceId,
      tableName,
      recordId,
      localSnapshot,
      remoteSnapshot,
      seq,
      createdAt: Date.now(),
    });
  }

  async resolveConflict(recordId: string, action: "accept-remote" | "keep-local"): Promise<void> {
    const conflict = await db.syncConflicts.get(recordId);
    if (!conflict) return;

    const table = getConflictTable(conflict.tableName) as unknown as {
      delete(id: string): Promise<void>;
      put(value: Record<string, unknown>): Promise<unknown>;
    };
    if (action === "accept-remote") {
      if (!conflict.remoteSnapshot) {
        await table.delete(conflict.recordId);
      } else {
        await table.put({ ...conflict.remoteSnapshot, syncStatus: "synced" });
      }
      await db.syncConflicts.delete(recordId);
      return;
    }

    if (!conflict.localSnapshot) {
      await db.syncConflicts.delete(recordId);
      return;
    }

    const remoteVersion = typeof conflict.remoteSnapshot?.version === "number" ? conflict.remoteSnapshot.version : 1;
    const localVersion = typeof conflict.localSnapshot.version === "number" ? conflict.localSnapshot.version : 1;
    await table.put({
      ...conflict.localSnapshot,
      syncStatus: "pending",
      version: Math.max(remoteVersion, localVersion) + 1,
    });
    await db.syncConflicts.delete(recordId);
  }

  async pushChanges(_payload?: SyncPayload): Promise<SyncResult> {
    const identity = getLocalIdentity();
    const sessionUser = getLocalSessionUser();
    if (!identity || !sessionUser) {
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
    const sessionUser = getLocalSessionUser();
    if (!identity || !sessionUser) {
      return {};
    }
    const spaceId = identity.space.id;
    const cursor = await this.getCursor(spaceId);

    if (cursor <= 0) {
      const snapshot = await this.pullFullSnapshot(spaceId);
      const serverCursor = await this.fetchServerCursor(spaceId);
      await this.setCursor(spaceId, serverCursor);
      await this.setLastSyncedAt(spaceId, Date.now());
      return snapshot;
    }

    let currentCursor = cursor;
    let hasMore = true;
    const aggregated: Partial<SyncPayload> = {
      menuItems: [],
      tags: [],
      comboTemplates: [],
    };

    while (hasMore) {
      const delta = await api<DeltaResponse>(
        `/sync/delta?space_id=${encodeURIComponent(spaceId)}&cursor=${currentCursor}`
      );
      await this.applyDelta(spaceId, delta);
      if (delta.changes.menuItems.length > 0) {
        aggregated.menuItems = [...(aggregated.menuItems ?? []), ...delta.changes.menuItems];
      }
      if (delta.changes.tags.length > 0) {
        aggregated.tags = [...(aggregated.tags ?? []), ...delta.changes.tags];
      }
      if (delta.changes.comboTemplates.length > 0) {
        aggregated.comboTemplates = [...(aggregated.comboTemplates ?? []), ...delta.changes.comboTemplates];
      }

      if (delta.cursor <= currentCursor) {
        hasMore = false;
        currentCursor = delta.serverCursor;
      } else {
        currentCursor = delta.cursor;
        hasMore = delta.hasMore;
      }
    }

    await this.setCursor(spaceId, currentCursor);
    await this.setLastSyncedAt(spaceId, Date.now());
    return aggregated;
  }

  async getSyncStatus(): Promise<SyncServiceStatus> {
    const identity = getLocalIdentity();
    if (!identity) {
      return {
        pendingCount: 0,
        conflictCount: 0,
        cursor: 0,
        connectionStatus: "offline",
        lastSyncedAt: undefined,
      };
    }
    const spaceId = identity.space.id;
    const [pendingMenu, pendingTags, pendingTemplates, pendingDel, pendingLikes, pendingComments, conflictCount, cursor, meta] = await Promise.all([
      db.menuItems.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.tags.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.comboTemplates.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.pendingDeletions.where({ spaceId }).count(),
      db.likes.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.comments.where({ spaceId }).and((x) => x.syncStatus === "pending").count(),
      db.syncConflicts.where("spaceId").equals(spaceId).count(),
      this.getCursor(spaceId),
      this.getConnectionMeta(spaceId),
    ]);
    const pendingCount = pendingMenu + pendingTags + pendingTemplates + pendingDel + pendingLikes + pendingComments;
    return {
      pendingCount,
      conflictCount,
      cursor,
      connectionStatus: meta.connectionStatus,
      lastEventAt: meta.lastEventAt,
      lastSyncedAt: meta.lastSyncedAt,
    };
  }

  async fetchChangeLogs(limit = 50): Promise<ChangeLog[]> {
    const identity = getLocalIdentity();
    if (!identity || !getLocalSessionUser()) return [];
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
    if (!identity || !getLocalSessionUser()) return [];
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
    if (!sid || !getLocalSessionUser()) return [];
    const cached = this.profilesCache;
    if (cached && cached.spaceId === sid && Date.now() - cached.timestamp < HttpSyncEngine.PROFILES_CACHE_TTL) {
      return cached.profiles;
    }
    const profiles = await api<Profile[]>(`/sync/profiles?space_id=${encodeURIComponent(sid)}`);
    this.profilesCache = { spaceId: sid, profiles, timestamp: Date.now() };
    return profiles;
  }

  async syncChanges(): Promise<SyncResult> {
    const pushResult = await this.pushChanges();
    if (!pushResult.success) return pushResult;
    await this.pullChanges();
    return { success: true };
  }

  subscribeToChanges(callback: () => void | Promise<void>): { unsubscribe: () => void } {
    const BASE_INTERVAL = 3000;
    const MAX_INTERVAL = 30000;
    let currentInterval = BASE_INTERVAL;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let stopped = false;
    let eventSource: EventSource | null = null;
    let usingPolling = false;
    const identity = getLocalIdentity();
    const spaceId = identity?.space.id;

    const isOnline = () => (typeof navigator !== "undefined" ? navigator.onLine : true) && !!getLocalSessionUser();

    const runCallback = async () => {
      if (stopped || running || !isOnline()) return;
      running = true;
      try {
        await Promise.resolve(callback());
        currentInterval = BASE_INTERVAL;
        if (spaceId && usingPolling) {
          void this.setConnectionStatus(spaceId, "polling");
        }
      } catch {
        currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
        if (spaceId) {
          void this.setConnectionStatus(spaceId, "polling");
        }
        throw new Error("sync callback failed");
      } finally {
        running = false;
      }
    };

    const scheduleNext = () => {
      if (stopped || !usingPolling) return;
      timerId = setTimeout(async () => {
        if (stopped || !usingPolling) return;
        if (!isOnline() || running) {
          scheduleNext();
          return;
        }
        try {
          await runCallback();
        } catch {
          // backoff already handled
        } finally {
          scheduleNext();
        }
      }, currentInterval);
    };

    const stopPolling = () => {
      usingPolling = false;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const startPolling = () => {
      if (stopped || usingPolling || !getLocalSessionUser()) return;
      usingPolling = true;
      currentInterval = BASE_INTERVAL;
      if (spaceId) {
        void this.setConnectionStatus(spaceId, isOnline() ? "polling" : "offline");
      }
      scheduleNext();
    };

    const stopStream = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const startStream = async () => {
      if (stopped || !spaceId || !getLocalSessionUser() || typeof window === "undefined" || typeof EventSource === "undefined") {
        startPolling();
        return;
      }

      stopPolling();
      const cursor = await this.getCursor(spaceId);
      const url = buildApiUrl(`/sync/events?space_id=${encodeURIComponent(spaceId)}&cursor=${cursor}`);
      const source = new EventSource(url);
      eventSource = source;

      source.addEventListener("open", () => {
        void this.setConnectionStatus(spaceId, "streaming");
      });

      source.addEventListener("hello", (event) => {
        const payload = parseSsePayload(event);
        const nextCursor = typeof payload?.cursor === "number" ? payload.cursor : undefined;
        if (typeof nextCursor === "number") {
          void this.setCursor(spaceId, Math.max(cursor, nextCursor));
        }
        void this.setConnectionStatus(spaceId, "streaming");
        void this.setLastEventAt(spaceId, Date.now());
      });

      source.addEventListener("heartbeat", () => {
        void this.setConnectionStatus(spaceId, "streaming");
        void this.setLastEventAt(spaceId, Date.now());
      });

      source.addEventListener("change", () => {
        void this.setConnectionStatus(spaceId, "streaming");
        void this.setLastEventAt(spaceId, Date.now());
        void runCallback().catch(() => {
          stopStream();
          startPolling();
        });
      });

      source.onerror = () => {
        stopStream();
        startPolling();
      };
    };

    if (spaceId && getLocalSessionUser() && typeof window !== "undefined" && typeof EventSource !== "undefined") {
      void startStream();
    } else if (getLocalSessionUser()) {
      startPolling();
    } else if (spaceId) {
      void this.setConnectionStatus(spaceId, "offline");
    }

    const handleOnline = () => {
      if (stopped || !getLocalSessionUser()) return;
      currentInterval = BASE_INTERVAL;
      if (spaceId && typeof EventSource !== "undefined" && typeof window !== "undefined") {
        stopPolling();
        void startStream();
        return;
      }
      if (!usingPolling) {
        startPolling();
      }
    };

    const handleOffline = () => {
      if (spaceId) {
        void this.setConnectionStatus(spaceId, "offline");
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return {
      unsubscribe: () => {
        stopped = true;
        stopPolling();
        stopStream();
        if (spaceId) {
          void this.setConnectionStatus(spaceId, "offline");
        }
        if (typeof window !== "undefined") {
          window.removeEventListener("online", handleOnline);
          window.removeEventListener("offline", handleOffline);
        }
      },
    };
  }

  private async pullFullSnapshot(spaceId: string): Promise<Partial<SyncPayload>> {
    const [menuItems, tags, comboTemplates, likes, comments, mappingRows] = await Promise.all([
      api<MenuItem[]>(`/sync/menu-items?space_id=${encodeURIComponent(spaceId)}`),
      api<Tag[]>(`/sync/tags?space_id=${encodeURIComponent(spaceId)}`),
      api<ComboTemplate[]>(`/sync/combo-templates?space_id=${encodeURIComponent(spaceId)}`),
      api<Like[]>(`/sync/likes?space_id=${encodeURIComponent(spaceId)}`),
      api<Comment[]>(`/sync/comments?space_id=${encodeURIComponent(spaceId)}`),
      db.tagMappings.where({ spaceId }).toArray(),
    ]);
    const sanitizedMenuItems = menuItems.map(
      (item) => sanitizeMenuItemRecord(item as unknown as Record<string, unknown>) as unknown as MenuItem
    );
    const tagMappingMap = new Map<string, string>(mappingRows.map((row) => [row.aliasId, row.canonicalId]));

    for (const remote of tags) {
      const local = await db.tags.get(remote.id);
      if (local) {
        if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
          if (isRemoteNewer(remote, local)) {
            await this.recordConflict(spaceId, "tags", remote.id, toSnapshot(local), toSnapshot(remote), remote.version ?? 1);
            await db.tags.update(remote.id, { syncStatus: "conflict" });
          }
          continue;
        }
        if (isRemoteNewer(remote, local)) {
          await db.tags.put({ ...remote, syncStatus: "synced" });
        }
        continue;
      }

      const existing = await db.tags.where("name").equals(remote.name).and((t) => t.type === remote.type).first();
      if (existing) {
        await db.tagMappings.put({ spaceId, aliasId: remote.id, canonicalId: existing.id });
        tagMappingMap.set(remote.id, existing.id);
      } else {
        await db.tags.add({ ...remote, syncStatus: "synced" });
      }
    }

    const remoteTagIds = new Set(tags.map((item) => item.id));
    const localTags = await db.tags.where("spaceId").equals(spaceId).toArray();
    const protectedCanonicalTagIds = new Set(tagMappingMap.values());
    for (const local of localTags) {
      if (local.syncStatus === "pending" || local.syncStatus === "conflict") continue;
      if (protectedCanonicalTagIds.has(local.id)) continue;
      if (!remoteTagIds.has(local.id)) {
        await db.tags.delete(local.id);
      }
    }

    for (const remote of sanitizedMenuItems) {
      const local = await db.menuItems.get(remote.id);
      const resolvedRemoteTags = resolveTagIds(remote.tags, tagMappingMap);
      if (!local) {
        await db.menuItems.add({ ...remote, tags: resolvedRemoteTags, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "menu_items", remote.id, toSnapshot(local), toSnapshot({ ...remote, tags: resolvedRemoteTags }), remote.version ?? 1);
          await db.menuItems.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        const mergedTags = Array.from(new Set([...resolvedRemoteTags, ...(local.tags || [])]));
        await db.menuItems.put({ ...remote, tags: mergedTags, syncStatus: "synced" });
      }
    }

    const remoteMenuIds = new Set(sanitizedMenuItems.map((item) => item.id));
    const localMenuItems = await db.menuItems.where("spaceId").equals(spaceId).toArray();
    for (const local of localMenuItems) {
      if (local.syncStatus === "pending" || local.syncStatus === "conflict") continue;
      if (!remoteMenuIds.has(local.id)) {
        await db.menuItems.delete(local.id);
      }
    }

    for (const remote of comboTemplates) {
      const local = await db.comboTemplates.get(remote.id);
      const resolvedRules = resolveComboRules(remote.rules, tagMappingMap);
      if (!local) {
        await db.comboTemplates.add({ ...remote, rules: resolvedRules, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "combo_templates", remote.id, toSnapshot(local), toSnapshot({ ...remote, rules: resolvedRules }), remote.version ?? 1);
          await db.comboTemplates.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        await db.comboTemplates.put({ ...remote, rules: resolvedRules, syncStatus: "synced" });
      }
    }

    const remoteTemplateIds = new Set(comboTemplates.map((item) => item.id));
    const localTemplates = await db.comboTemplates.where("spaceId").equals(spaceId).toArray();
    for (const local of localTemplates) {
      if (local.syncStatus === "pending" || local.syncStatus === "conflict") continue;
      if (!remoteTemplateIds.has(local.id)) {
        await db.comboTemplates.delete(local.id);
      }
    }

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
      } else if (existing.syncStatus !== "pending") {
        await db.likes.put({ ...normalizedRemote, syncStatus: "synced" });
      }
    }

    const remoteLikeKeys = new Set(likes.map((item) => `${item.menuItemId}:${item.profileId}`));
    const localLikes = await db.likes.where("spaceId").equals(spaceId).toArray();
    const likesToDelete = localLikes
      .filter((local) => local.syncStatus !== "pending" && !remoteLikeKeys.has(`${local.menuItemId}:${local.profileId}`))
      .map((local) => local.id);
    if (likesToDelete.length > 0) {
      await db.likes.bulkDelete(likesToDelete);
    }

    for (const remote of comments) {
      const local = await db.comments.get(remote.id);
      if (!local) {
        await db.comments.add({ ...remote, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "comments", remote.id, toSnapshot(local), toSnapshot(remote), remote.version ?? 1);
          await db.comments.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        await db.comments.put({ ...remote, syncStatus: "synced" });
      }
    }

    const remoteCommentIds = new Set(comments.map((item) => item.id));
    const localComments = await db.comments.where("spaceId").equals(spaceId).toArray();
    const commentsToDelete = localComments
      .filter((local) => local.syncStatus !== "pending" && !remoteCommentIds.has(local.id))
      .map((local) => local.id);
    if (commentsToDelete.length > 0) {
      await db.comments.bulkDelete(commentsToDelete);
    }

    return { menuItems: sanitizedMenuItems, tags, comboTemplates };
  }

  private async applyDelta(spaceId: string, delta: DeltaResponse): Promise<void> {
    const mappingRows = await db.tagMappings.where({ spaceId }).toArray();
    const tagMappingMap = new Map<string, string>(mappingRows.map((row) => [row.aliasId, row.canonicalId]));

    for (const remote of delta.changes.tags) {
      const local = await db.tags.get(remote.id);
      if (local) {
        if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
          if (isRemoteNewer(remote, local)) {
            await this.recordConflict(spaceId, "tags", remote.id, toSnapshot(local), toSnapshot(remote), delta.cursor);
            await db.tags.update(remote.id, { syncStatus: "conflict" });
          }
          continue;
        }
        if (isRemoteNewer(remote, local)) {
          await db.tags.put({ ...remote, syncStatus: "synced" });
        }
        continue;
      }

      const existing = await db.tags.where("name").equals(remote.name).and((t) => t.type === remote.type).first();
      if (existing) {
        await db.tagMappings.put({ spaceId, aliasId: remote.id, canonicalId: existing.id });
        tagMappingMap.set(remote.id, existing.id);
      } else {
        await db.tags.add({ ...remote, syncStatus: "synced" });
      }
    }

    for (const remote of delta.changes.menuItems.map(
      (item) => sanitizeMenuItemRecord(item as unknown as Record<string, unknown>) as unknown as MenuItem
    )) {
      const resolvedRemoteTags = resolveTagIds(remote.tags, tagMappingMap);
      const local = await db.menuItems.get(remote.id);
      if (!local) {
        await db.menuItems.add({ ...remote, tags: resolvedRemoteTags, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "menu_items", remote.id, toSnapshot(local), toSnapshot({ ...remote, tags: resolvedRemoteTags }), delta.cursor);
          await db.menuItems.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        const mergedTags = Array.from(new Set([...resolvedRemoteTags, ...(local.tags || [])]));
        await db.menuItems.put({ ...remote, tags: mergedTags, syncStatus: "synced" });
      }
    }

    for (const remote of delta.changes.comboTemplates) {
      const resolvedRules = resolveComboRules(remote.rules, tagMappingMap);
      const local = await db.comboTemplates.get(remote.id);
      if (!local) {
        await db.comboTemplates.add({ ...remote, rules: resolvedRules, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "combo_templates", remote.id, toSnapshot(local), toSnapshot({ ...remote, rules: resolvedRules }), delta.cursor);
          await db.comboTemplates.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        await db.comboTemplates.put({ ...remote, rules: resolvedRules, syncStatus: "synced" });
      }
    }

    for (const remote of delta.changes.likes) {
      const normalizedRemote = remote.spaceId
        ? { ...remote, id: buildLikeId(remote.spaceId, remote.menuItemId, remote.profileId) }
        : remote;
      const existing = await db.likes
        .where("[menuItemId+profileId]")
        .equals([normalizedRemote.menuItemId, normalizedRemote.profileId])
        .first();
      if (!existing) {
        await db.likes.add({ ...normalizedRemote, syncStatus: "synced" });
      } else {
        if (existing.id !== normalizedRemote.id && existing.syncStatus !== "pending") {
          await db.likes.delete(existing.id);
        }
        await db.likes.put({ ...normalizedRemote, syncStatus: "synced" });
      }
    }

    for (const remote of delta.changes.comments) {
      const local = await db.comments.get(remote.id);
      if (!local) {
        await db.comments.add({ ...remote, syncStatus: "synced" });
        continue;
      }

      if (local.syncStatus === "pending" || local.syncStatus === "conflict") {
        if (isRemoteNewer(remote, local)) {
          await this.recordConflict(spaceId, "comments", remote.id, toSnapshot(local), toSnapshot(remote), delta.cursor);
          await db.comments.update(remote.id, { syncStatus: "conflict" });
        }
        continue;
      }

      if (isRemoteNewer(remote, local)) {
        await db.comments.put({ ...remote, syncStatus: "synced" });
      }
    }

    for (const id of delta.deleted.menu_items) {
      await this.applyRemoteDeletion(spaceId, "menu_items", id, delta.cursor);
    }
    for (const id of delta.deleted.tags) {
      await this.applyRemoteDeletion(spaceId, "tags", id, delta.cursor);
    }
    for (const id of delta.deleted.combo_templates) {
      await this.applyRemoteDeletion(spaceId, "combo_templates", id, delta.cursor);
    }
    for (const id of delta.deleted.likes) {
      await this.applyRemoteDeletion(spaceId, "likes", id, delta.cursor);
    }
    for (const id of delta.deleted.comments) {
      await this.applyRemoteDeletion(spaceId, "comments", id, delta.cursor);
    }
  }

  private async applyRemoteDeletion(
    spaceId: string,
    tableName: SyncConflict["tableName"],
    recordId: string,
    seq: number
  ): Promise<void> {
    const table = getConflictTable(tableName);
    const local = await table.get(recordId);
    if (!local) {
      return;
    }

    if ((local as VersionedRecord).syncStatus === "pending" || (local as VersionedRecord).syncStatus === "conflict") {
      await this.recordConflict(spaceId, tableName, recordId, toSnapshot(local), null, seq);
      await table.update(recordId, { syncStatus: "conflict" });
      return;
    }

    await table.delete(recordId);
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

function getConflictTable(tableName: SyncConflict["tableName"]) {
  switch (tableName) {
    case "menu_items":
      return db.menuItems;
    case "tags":
      return db.tags;
    case "combo_templates":
      return db.comboTemplates;
    case "likes":
      return db.likes;
    case "comments":
      return db.comments;
    default:
      throw new Error(`Unknown conflict table: ${tableName satisfies never}`);
  }
}

function isRemoteNewer<T extends VersionedRecord>(remote: T, local: T): boolean {
  const remoteVersion = remote.version ?? 1;
  const localVersion = local.version ?? 1;
  if (remoteVersion !== localVersion) {
    return remoteVersion > localVersion;
  }
  const remoteTimestamp = remote.updatedAt ?? remote.createdAt ?? 0;
  const localTimestamp = local.updatedAt ?? local.createdAt ?? 0;
  return remoteTimestamp > localTimestamp;
}

function toSnapshot(record: unknown): Record<string, unknown> | null {
  if (!record || typeof record !== "object") return null;
  return record as Record<string, unknown>;
}

function parseSsePayload(event: MessageEvent<string>): Record<string, unknown> | null {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
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
