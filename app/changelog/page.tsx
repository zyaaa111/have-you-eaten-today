"use client";

import { useEffect, useState } from "react";
import { syncEngine } from "@/lib/sync-engine";
import type { ChangeLog } from "@/lib/types";
import { History, ArrowLeft, RotateCcw, Trash2, Plus, FileEdit } from "lucide-react";
import { useRouter } from "next/navigation";

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN");
}

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
  const [filter, setFilter] = useState<"all" | ChangeLog["operation"]> ("all");

  useEffect(() => {
    syncEngine.fetchChangeLogs(100).then((data) => {
      setLogs(data);
      setLoading(false);
    });
  }, []);

  const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.operation === filter);

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

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中…</div>
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
                      {log.tableName === "menu_items" ? "菜单" : log.tableName === "tags" ? "标签" : "模板"}
                    </span>
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
