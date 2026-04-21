"use client";
import { reportSyncError } from "@/lib/error-monitor";

import { useEffect, useMemo, useState } from "react";
import { syncEngine } from "@/lib/sync-engine";
import type { ChangeLog, Profile } from "@/lib/types";
import { History, ArrowLeft, RotateCcw, Trash2, Plus, FileEdit } from "lucide-react";
import { useRouter } from "next/navigation";

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN");
}

const tableLabels: Record<ChangeLog["tableName"], string> = {
  menu_items: "菜单",
  tags: "标签",
  combo_templates: "模板",
  likes: "点赞",
  comments: "评论",
};

function getRecordName(log: ChangeLog): string {
  const snap = log.afterSnapshot || log.beforeSnapshot;
  if (snap && typeof snap.name === "string") return snap.name;
  return log.recordId.slice(0, 8);
}

function getDiffLines(log: ChangeLog): string[] {
  if (log.operation !== "update" || !log.beforeSnapshot || !log.afterSnapshot) return [];
  const before = log.beforeSnapshot;
  const after = log.afterSnapshot;
  const lines: string[] = [];
  for (const key of Object.keys(after)) {
    if (key === "updatedAt" || key === "version" || key === "syncStatus") continue;
    const b = JSON.stringify(before[key]);
    const a = JSON.stringify(after[key]);
    if (b !== a) {
      lines.push(`${key}: ${b} → ${a}`);
    }
  }
  return lines;
}

export default function ChangeLogPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | ChangeLog["operation"]> ("all");
  const [tableFilter, setTableFilter] = useState<"all" | ChangeLog["tableName"]>("all");
  const [memberFilter, setMemberFilter] = useState<"all" | string>("all");
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    let active = true;

    const loadLogs = async () => {
      try {
        const data = await syncEngine.fetchChangeLogs(100);
        if (!active) return;
        setLogs(data);
        const members = await syncEngine.fetchProfiles();
        if (!active) return;
        setProfiles(members);
        setError("");
      } catch (error) {
        if (!active) return;
        setError("变更记录加载失败，请稍后重试。");
        reportSyncError("Change log page load failed", { error: String(error) });
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadLogs();

    return () => {
      active = false;
    };
  }, []);

  const memberOptions = useMemo(() => {
    const knownProfiles = new Map(profiles.map((profile) => [profile.id, profile.nickname]));
    for (const log of logs) {
      if (log.profileId && log.actorNickname && !knownProfiles.has(log.profileId)) {
        knownProfiles.set(log.profileId, log.actorNickname);
      }
    }
    return Array.from(knownProfiles.entries()).map(([id, nickname]) => ({ id, nickname }));
  }, [logs, profiles]);

  const filteredLogs = logs.filter((log) => {
    if (filter !== "all" && log.operation !== filter) return false;
    if (tableFilter !== "all" && log.tableName !== tableFilter) return false;
    if (memberFilter !== "all" && log.profileId !== memberFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <History className="w-5 h-5" />
          变更记录
        </h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "create", "update", "delete"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted"
            }`}
          >
            {f === "all" ? "全部" : f === "create" ? "新增" : f === "update" ? "修改" : "删除"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value as "all" | ChangeLog["tableName"])}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="all">全部表类型</option>
          <option value="menu_items">菜单</option>
          <option value="tags">标签</option>
          <option value="combo_templates">模板</option>
          <option value="likes">点赞</option>
          <option value="comments">评论</option>
        </select>
        <select
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="all">全部成员</option>
          {memberOptions.map((member) => (
            <option key={member.id} value={member.id}>
              {member.nickname}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-10 text-center text-sm text-red-600">
          {error}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          暂无变更记录
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => {
            const name = getRecordName(log);
            const diffs = getDiffLines(log);
            return (
              <div key={log.id} className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {log.operation === "create" && <Plus className="w-4 h-4 text-emerald-600" />}
                    {log.operation === "update" && <FileEdit className="w-4 h-4 text-blue-600" />}
                    {log.operation === "delete" && <Trash2 className="w-4 h-4 text-red-600" />}
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {tableLabels[log.tableName]}
                    </span>
                    {log.actorNickname && (
                      <span className="text-xs text-muted-foreground">· {log.actorNickname}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatTime(log.createdAt)}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {log.operation === "create" && "新增了此记录"}
                  {log.operation === "delete" && "删除了此记录"}
                  {log.operation === "update" && (diffs.length > 0 ? (
                    <ul className="space-y-1">
                      {diffs.map((d, i) => (
                        <li key={i} className="text-xs font-mono bg-muted/50 rounded px-2 py-1">{d}</li>
                      ))}
                    </ul>
                  ) : "修改了此记录")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
