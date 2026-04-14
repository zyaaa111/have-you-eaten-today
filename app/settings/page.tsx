"use client";

import { useRef, useState, useEffect } from "react";
import { exportData, downloadExport, importData } from "@/lib/io";
import { resetDatabase } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { getDefaultDedupDays, saveSetting, getSetting, getDedupEnabled, getTheme } from "@/lib/settings";
import { applyThemeToDOM } from "@/components/theme-provider";
import type { AppSettings } from "@/lib/types";
import { getLocalIdentity, clearLocalIdentity } from "@/lib/supabase";
import { syncEngine } from "@/lib/sync-engine";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>("");
  const [dedupDays, setDedupDays] = useState<number>(7);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [dedupEnabled, setDedupEnabled] = useState<boolean>(true);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [theme, setTheme] = useState<AppSettings["theme"]>("default");
  const [identity, setIdentity] = useState<ReturnType<typeof getLocalIdentity>>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    Promise.all([
      getDefaultDedupDays(),
      getDedupEnabled(),
      getSetting<number | null>("lastBackupAt", null),
      getTheme(),
    ]).then(([days, enabled, backup, t]) => {
      setDedupDays(days);
      setDedupEnabled(enabled);
      setLastBackupAt(backup);
      setTheme(t);
      setLoadingSettings(false);
    });
    setIdentity(getLocalIdentity());
    syncEngine.getSyncStatus().then((s) => setPendingCount(s.pendingCount));
  }, []);

  const handleDedupDaysChange = async (value: number) => {
    const num = Math.max(1, Math.min(30, Math.floor(value)));
    setDedupDays(num);
    await saveSetting("defaultDedupDays", num);
    setMessage("设置已保存");
    setTimeout(() => setMessage(""), 2000);
  };

  const handleDedupEnabledChange = async (enabled: boolean) => {
    setDedupEnabled(enabled);
    await saveSetting("dedupEnabled", enabled);
    setMessage("设置已保存");
    setTimeout(() => setMessage(""), 2000);
  };

  const handleThemeChange = async (value: AppSettings["theme"]) => {
    setTheme(value);
    await saveSetting("theme", value);
    applyThemeToDOM(value);
    setMessage("主题已切换");
    setTimeout(() => setMessage(""), 2000);
  };

  const handleExport = async () => {
    const data = await exportData();
    downloadExport(data);
    const now = Date.now();
    await saveSetting("lastBackupAt", now);
    setLastBackupAt(now);
    setMessage("导出成功");
    setTimeout(() => setMessage(""), 3000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importData(file);
    if (result.success) {
      setMessage("导入成功，页面即将刷新…");
      setTimeout(() => window.location.reload(), 800);
    } else {
      setMessage(`导入失败：${result.error}`);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleReset = async () => {
    if (!confirm("确定要清空所有数据并恢复初始状态吗？此操作不可恢复。")) return;
    await resetDatabase();
    await seedDatabase();
    setMessage("数据已重置");
    setTimeout(() => window.location.reload(), 500);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    const pushResult = await syncEngine.pushChanges();
    if (pushResult.success) {
      await syncEngine.pullChanges();
      setMessage("同步成功");
    } else {
      setMessage(`同步遇到问题：${pushResult.error || "未知错误"}`);
    }
    const status = await syncEngine.getSyncStatus();
    setPendingCount(status.pendingCount);
    setSyncing(false);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleLeaveSpace = () => {
    if (!confirm("确定要退出当前空间吗？本地数据不会丢失。")) return;
    clearLocalIdentity();
    setIdentity(null);
    setMessage("已退出空间");
    setTimeout(() => setMessage(""), 2000);
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-bold">设置</h2>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">共享空间</h3>
        {identity ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div className="text-muted-foreground">空间名称</div>
              <div className="font-medium">{identity.space.name}</div>
            </div>
            <div className="text-sm">
              <div className="text-muted-foreground">邀请码</div>
              <div className="font-mono font-medium">{identity.space.inviteCode}</div>
            </div>
            <div className="text-sm">
              <div className="text-muted-foreground">我的昵称</div>
              <div className="font-medium">{identity.profile.nickname}</div>
            </div>
            <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-700">
              当前为本地后端模式，数据保存在本地服务器。
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {syncing ? "同步中…" : `立即同步${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
              </button>
              <button
                onClick={() => router.push("/changelog")}
                className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                查看变更记录
              </button>
              <button
                onClick={handleLeaveSpace}
                className="inline-flex items-center justify-center rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                退出空间
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">你尚未加入任何共享空间。</p>
            <button
              onClick={() => router.push("/join")}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              加入或创建空间
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">个人偏好</h3>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">我的忌口</div>
          <button
            onClick={() => router.push("/avoidances")}
            className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            查看与管理
          </button>
        </div>
        <div className="border-t" />
        <h3 className="font-semibold">随机设置</h3>
        <p className="text-sm text-muted-foreground">
          调整默认去重天数，控制随机抽取时避免重复出现近期已选中的菜单项。
        </p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="dedup-enabled" className="text-sm font-medium">
              启用智能去重
            </label>
            <button
              id="dedup-enabled"
              role="switch"
              aria-checked={dedupEnabled}
              disabled={loadingSettings}
              onClick={() => handleDedupEnabledChange(!dedupEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                dedupEnabled ? "bg-primary" : "bg-muted"
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  dedupEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            关闭后，随机抽取将不再参考历史记录进行降权。
          </p>

          <div className={`space-y-3 ${!dedupEnabled ? "opacity-50 pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between">
              <label htmlFor="dedup-days" className="text-sm font-medium">
                默认去重天数
              </label>
              <span className="text-sm font-semibold tabular-nums">{dedupDays} 天</span>
            </div>
            <input
              id="dedup-days"
              type="range"
              min={1}
              max={30}
              value={dedupDays}
              disabled={loadingSettings || !dedupEnabled}
              onChange={(e) => handleDedupDaysChange(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 天</span>
              <span>30 天</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">界面风格</h3>
        <p className="text-sm text-muted-foreground">
          切换应用的配色与字体风格，随时根据个人喜好调整。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            {
              key: "default",
              label: "默认明亮",
              preview: "bg-white border-gray-200",
            },
            {
              key: "dark",
              label: "暗黑风格",
              preview: "bg-neutral-900 border-neutral-700",
            },
            {
              key: "scrapbook",
              label: "复古手账",
              preview: "bg-[#fdf6e3] border-[#dccfc1]",
            },
          ] as { key: AppSettings["theme"]; label: string; preview: string }[]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleThemeChange(opt.key)}
              disabled={loadingSettings}
              className={`relative text-left rounded-xl border p-3 transition ${
                theme === opt.key
                  ? "border-primary ring-2 ring-primary/20"
                  : "hover:bg-muted"
              } disabled:opacity-50`}
            >
              <div className={`h-10 w-full rounded-md border mb-2 ${opt.preview}`} />
              <div className="text-sm font-medium">{opt.label}</div>
              {theme === opt.key && (
                <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px]">
                  ✓
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">数据备份</h3>
        <p className="text-sm text-muted-foreground">
          你的所有数据都保存在浏览器本地，建议定期导出备份，以防清理缓存导致数据丢失。
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            导出备份（JSON）
          </button>
          <label className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted cursor-pointer">
            导入备份
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImport}
            />
          </label>
        </div>
        {lastBackupAt ? (
          <p className="text-xs text-muted-foreground">
            上次备份：{new Date(lastBackupAt).toLocaleString("zh-CN")}
            {Date.now() - lastBackupAt > 7 * 24 * 60 * 60 * 1000 && (
              <span className="ml-2 text-amber-600">已超过 7 天，建议尽快备份</span>
            )}
          </p>
        ) : (
          <p className="text-xs text-amber-600">尚未进行过备份</p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold text-destructive">危险操作</h3>
        <p className="text-sm text-muted-foreground">清空所有本地数据并恢复初始示例数据。</p>
        <button
          onClick={handleReset}
          className="inline-flex items-center justify-center rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          重置数据
        </button>
      </section>

      {message && (
        <div className="rounded-md bg-muted p-3 text-sm text-foreground">{message}</div>
      )}
    </div>
  );
}
