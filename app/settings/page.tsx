"use client";

import { useRef, useState, useEffect } from "react";
import { downloadBackupArchive, exportBackupArchive, importData } from "@/lib/io";
import { resetDatabase, resetLocalSessionData } from "@/lib/db";
import { useLiveQuery } from "@/lib/use-live-query";
import { seedDatabase } from "@/lib/seed";
import { getDefaultDedupDays, saveSetting, getSetting, getDedupEnabled, getTheme } from "@/lib/settings";
import { applyThemeToDOM } from "@/components/theme-provider";
import type { AppSettings, SyncConflict } from "@/lib/types";
import { getLocalIdentity, clearLocalIdentity } from "@/lib/identity";
import { syncEngine } from "@/lib/sync-engine";
import { detachSpaceData } from "@/lib/space-ops";
import { clearCurrentProfileState } from "@/lib/profile-state";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { db } from "@/lib/db";
import { useAuth } from "@/components/auth-provider";
import { bindLocalProfile, changePassword } from "@/lib/auth-client";

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout, refreshSession, passwordResetConfigured } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>("");
  const [dedupDays, setDedupDays] = useState<number>(7);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [dedupEnabled, setDedupEnabled] = useState<boolean>(true);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [theme, setTheme] = useState<AppSettings["theme"]>("default");
  const [identity, setIdentity] = useState<ReturnType<typeof getLocalIdentity>>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<Awaited<ReturnType<typeof syncEngine.getSyncStatus>>>({
    pendingCount: 0,
    conflictCount: 0,
    cursor: 0,
    connectionStatus: "offline",
  });
  const [syncing, setSyncing] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [bindingLegacyProfile, setBindingLegacyProfile] = useState(false);
  const conflicts = useLiveQuery(
    () => (identity ? db.syncConflicts.where("spaceId").equals(identity.space.id).toArray() : Promise.resolve([] as SyncConflict[])),
    [identity?.space.id]
  ) ?? [];

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
    const localIdentity = getLocalIdentity();
    setIdentity(localIdentity);
    syncEngine.getSyncStatus().then((s) => {
      setSyncStatus(s);
      setPendingCount(s.pendingCount);
    });
    if (localIdentity) {
      syncEngine.fetchProfiles(localIdentity.space.id).then(setMembers).catch(() => {});
    }

    const timer = setInterval(() => {
      syncEngine.getSyncStatus().then((s) => {
        setSyncStatus(s);
        setPendingCount(s.pendingCount);
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [user?.id]);

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
    const archive = await exportBackupArchive();
    downloadBackupArchive(archive);
    const now = Date.now();
    await saveSetting("lastBackupAt", now);
    setLastBackupAt(now);
    setMessage("导出成功");
    setTimeout(() => setMessage(""), 3000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (identity) {
      setMessage("当前仍在共享空间中，个人备份导入仅支持本地模式，请先退出空间后再导入");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setTimeout(() => setMessage(""), 3000);
      return;
    }
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
    const confirmed = confirm(
      identity
        ? "确定要清空当前设备上的本地数据并重新同步共享空间吗？这不会退出空间；个人历史、忌口和个人权重会被清空，界面设置会保留。"
        : "确定要清空所有本地数据并恢复初始示例数据吗？此操作不可恢复。"
    );
    if (!confirmed) return;

    try {
      if (identity) {
        await resetLocalSessionData();
        await clearCurrentProfileState();
        await syncEngine.pullChanges();
        const status = await syncEngine.getSyncStatus();
        setSyncStatus(status);
        setPendingCount(status.pendingCount);
        setMessage("当前设备的本地数据和当前账号在此空间下的个人偏好已清空，并已重新同步共享空间；界面设置已保留");
        setTimeout(() => setMessage(""), 3000);
        return;
      }

      await resetDatabase();
      await seedDatabase();
      setMessage("数据已重置，示例数据已恢复");
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置数据失败");
      setTimeout(() => setMessage(""), 3000);
    }
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
    setSyncStatus(status);
    setPendingCount(status.pendingCount);
    setSyncing(false);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleResolveConflict = async (conflictId: string, action: "accept-remote" | "keep-local") => {
    await syncEngine.resolveConflict(conflictId, action);
    const status = await syncEngine.getSyncStatus();
    setSyncStatus(status);
    setPendingCount(status.pendingCount);
    setMessage(action === "accept-remote" ? "已接受远端版本" : "已保留本地版本并重新加入同步队列");
    setTimeout(() => setMessage(""), 3000);
  };

  const connectionLabel =
    syncStatus.connectionStatus === "streaming"
      ? "SSE 实时推送"
      : syncStatus.connectionStatus === "polling"
        ? "轮询回退"
        : "离线";

  const handleLeaveSpace = async () => {
    if (!identity) return;
    const confirmed = confirm(
      "确定要退出当前空间吗？菜单、标签和模板会保留为本地数据；共享点赞和评论会被移除，当前空间下跟账号绑定的私有偏好不会转成本地模式。"
    );
    if (!confirmed) return;

    try {
      await detachSpaceData(identity.space.id);
      clearLocalIdentity();
      setIdentity(null);
      setMembers([]);
      setPendingCount(0);
      setMessage("已退出空间，核心内容已转为本地数据；共享点赞和评论已移除，账号绑定的私有偏好仍保留在对应空间身份下");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出空间失败");
    }
    setTimeout(() => setMessage(""), 3000);
  };

  const canBindLocalProfile = !!user && !!identity && !identity.profile.userId;

  const handleBindLocalProfile = async () => {
    if (!identity || !user) return;
    setBindingLegacyProfile(true);
    try {
      await bindLocalProfile(identity.profile.id, identity.space.id);
      await refreshSession();
      setIdentity(getLocalIdentity());
      setMessage("当前设备保存的旧空间身份已绑定到这个账号");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "绑定旧身份失败");
    } finally {
      setBindingLegacyProfile(false);
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newPassword || !confirmPassword) {
      setMessage("请输入并确认新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }

    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      await refreshSession();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(user?.hasPassword ? "密码已修改" : "密码已设置");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改密码失败");
    } finally {
      setPasswordBusy(false);
      setTimeout(() => setMessage(""), 3000);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-bold">设置</h2>

      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">账号</h3>
        {authLoading ? (
          <p className="text-sm text-muted-foreground">正在恢复登录状态…</p>
        ) : user ? (
          <div className="space-y-3">
            <div className="text-sm">
              <div className="text-muted-foreground">当前账号</div>
              <div className="font-medium">{user.email}</div>
            </div>
            <div className="rounded-md bg-emerald-50 p-3 text-xs text-emerald-700">
              账号用于跨设备识别同一个人；空间内仍然显示你的空间昵称。收藏、忌口、想吃、个人权重和场景清单会跟随账号绑定到当前空间身份。
            </div>
            {canBindLocalProfile && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-2">
                <div>当前设备保存了一个还没绑定账号的旧空间身份。</div>
                <button
                  onClick={handleBindLocalProfile}
                  disabled={bindingLegacyProfile}
                  className="inline-flex items-center justify-center rounded-md bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {bindingLegacyProfile ? "绑定中…" : "绑定当前设备旧身份"}
                </button>
              </div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">{user.hasPassword ? "修改密码" : "设置登录密码"}</div>
              {!user.hasPassword && !passwordResetConfigured && (
                <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-700">
                  当前没有配置 QQ SMTP；如果未来忘记密码，将无法通过邮件找回。
                </div>
              )}
              {user.hasPassword && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">当前密码</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="至少 8 位，包含字母和数字"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={passwordBusy}
                  className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {passwordBusy ? "提交中…" : user.hasPassword ? "修改密码" : "设置密码"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  忘记密码
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                忘记密码和首次设密通过 QQ SMTP 邮件完成；真实 SMTP 凭据只放在 `.env.local` 或部署环境变量中，不会进入 Git。
              </div>
            </form>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => router.push("/login?redirect=/settings")}
                className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                切换账号
              </button>
              <button
                onClick={async () => {
                  await logout();
                  await refreshSession();
                  setMessage("已退出账号登录；当前设备仍会保留空间指针，但共享同步会立即停止，重新登录后才能继续访问共享空间");
                  setTimeout(() => setMessage(""), 3000);
                }}
                className="inline-flex items-center justify-center rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              登录后才能在多台设备之间同步你的私有偏好；创建和加入共享空间也需要先登录账号。
            </p>
            {identity && (
              <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-700">
                当前设备上已经有一个空间身份，但还没有绑定账号。登录后可以在这里手动绑定当前设备旧身份，不会重置已有共享数据。
              </div>
            )}
            <button
              onClick={() => router.push("/login?redirect=/settings")}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              登录账号
            </button>
          </div>
        )}
      </section>

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
              当前为本地后端模式：共享菜单和互动保存在本地服务器；私有偏好会跟账号绑定到当前空间身份。
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">连接状态</div>
                <div className="text-sm font-medium">{connectionLabel}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">增量游标</div>
                <div className="text-sm font-medium">{syncStatus.cursor ?? 0}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">最后事件</div>
                <div className="text-sm font-medium">
                  {syncStatus.lastEventAt ? new Date(syncStatus.lastEventAt).toLocaleTimeString("zh-CN") : "暂无"}
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">未解决冲突</div>
                <div className="text-sm font-medium">{syncStatus.conflictCount ?? conflicts.length}</div>
              </div>
            </div>
            {members.length > 0 && (
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">空间成员</div>
                <div className="space-y-1">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                      <span className="font-medium">
                        {m.nickname}
                        {!m.isAccountBound && <span className="ml-1 text-xs text-amber-600">待绑定</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.joinedAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">同步冲突</div>
                <div className="space-y-2">
                  {conflicts.map((conflict) => (
                    <div key={conflict.id} className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <div className="text-sm font-medium">
                        {conflict.tableName} · {conflict.recordId.slice(0, 12)}
                      </div>
                      <div className="text-xs text-amber-700">
                        本地待同步记录遇到了远端更新，请选择保留哪一边的版本。
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleResolveConflict(conflict.id, "keep-local")}
                          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          保留我的版本
                        </button>
                        <button
                          onClick={() => handleResolveConflict(conflict.id, "accept-remote")}
                          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          接受远端版本
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          {identity
            ? "当前导出的是本地私有备份：包含界面设置、抽取历史，以及未加入共享空间的本地菜单、标签、模板、收藏、想吃、忌口、个人权重和本地场景清单；当前空间内跟账号绑定的私有偏好不进入个人备份。"
            : "导出的是全量本地私有数据备份：包含界面设置、抽取历史、本地菜单、标签、模板、收藏、想吃、忌口、个人权重和本地场景清单。"}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            导出备份（ZIP）
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!identity}
            className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            导入备份
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,application/json,application/zip"
            className="hidden"
            disabled={!!identity}
            onChange={handleImport}
          />
        </div>
        {identity && (
          <p className="text-xs text-muted-foreground">
            当前仍在共享空间中，导入个人备份会打乱空间归属，因此本轮仅允许在本地模式下恢复备份。
          </p>
        )}
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
        <p className="text-sm text-muted-foreground">
          {identity
            ? "清空当前设备上的本地缓存并重新同步当前共享空间；不会退出空间，界面设置会保留，但当前空间下跟账号绑定的个人偏好和个人历史会被清空。"
            : "清空所有本地数据并恢复初始示例数据。"}
        </p>
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
