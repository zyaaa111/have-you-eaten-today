import { MenuItem, RollHistory, ComboTemplate, Tag } from "./types";
import { syncEngine } from "./http-sync-engine";

export interface SyncPayload {
  tags: Tag[];
  menuItems: MenuItem[];
  comboTemplates: ComboTemplate[];
  rollHistory: RollHistory[];
}

export interface SyncResult {
  success: boolean;
  remoteIdMap?: Record<string, string>; // localId -> remoteId
  error?: string;
}

export interface SyncStatus {
  lastSyncedAt?: number;
  pendingCount: number;
}

export interface SyncService {
  /** 将本地数据推送到服务端 */
  pushChanges(payload: SyncPayload): Promise<SyncResult>;
  /** 从服务端拉取最新数据 */
  pullChanges(): Promise<Partial<SyncPayload>>;
  /** 获取当前同步状态 */
  getSyncStatus(): Promise<SyncStatus>;
}

/** 本地 Mock 实现：所有操作立即返回成功，用于网络版上线前的占位 */
export class LocalMockSyncService implements SyncService {
  async pushChanges(_payload: SyncPayload): Promise<SyncResult> {
    return { success: true };
  }

  async pullChanges(): Promise<Partial<SyncPayload>> {
    return {};
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return { pendingCount: 0, lastSyncedAt: Date.now() };
  }
}

/** 全局单例：使用 HttpSyncEngine（连接本地 Node.js + SQLite 后端） */
export const syncService: SyncService = syncEngine;
