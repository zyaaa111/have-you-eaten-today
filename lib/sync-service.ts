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
  error?: string;
}

export interface SyncStatus {
  lastSyncedAt?: number;
  pendingCount: number;
  conflictCount?: number;
  cursor?: number;
  connectionStatus?: "offline" | "polling" | "streaming";
  lastEventAt?: number;
}

export interface SyncService {
  /** 将本地数据推送到服务端 */
  pushChanges(payload: SyncPayload): Promise<SyncResult>;
  /** 从服务端拉取最新数据 */
  pullChanges(): Promise<Partial<SyncPayload>>;
  /** 获取当前同步状态 */
  getSyncStatus(): Promise<SyncStatus>;
  /** 推送后立即拉取，一站式同步 */
  syncChanges(): Promise<SyncResult>;
  /** 订阅变更，定期轮询同步 */
  subscribeToChanges(callback: () => void | Promise<void>): { unsubscribe: () => void };
}

/** 全局单例：使用 HttpSyncEngine（连接本地 Node.js + SQLite 后端） */
export const syncService: SyncService = syncEngine;
