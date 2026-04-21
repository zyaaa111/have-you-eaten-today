"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveLocalIdentity, getLocalIdentity, clearLocalIdentity } from "@/lib/identity";
import { buildApiUrl } from "@/lib/api-base";
import type { Space, Profile } from "@/lib/types";
import { attachLocalDataToSpace, detachSpaceData } from "@/lib/space-ops";
import { useAuth } from "@/components/auth-provider";
import { bindLocalProfile } from "@/lib/auth-client";
import { seedDatabase } from "@/lib/seed";
import { syncEngine } from "@/lib/sync-engine";

export default function JoinPage() {
  const router = useRouter();
  const { user, loading: authLoading, refreshSession } = useAuth();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasIdentity, setHasIdentity] = useState(false);
  const [bindingLegacyProfile, setBindingLegacyProfile] = useState(false);

  useEffect(() => {
    const identity = getLocalIdentity();
    setHasIdentity(!!identity);
  }, [user?.id]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (hasIdentity || getLocalIdentity()) {
      setHasIdentity(true);
      setError("请先退出当前空间，再加入或创建新空间");
      return;
    }
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    if (!user) {
      setError("请先登录账号");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(buildApiUrl("/spaces/join"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: inviteCode.trim().toUpperCase(),
          nickname: nickname.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "加入空间失败");
        setLoading(false);
        return;
      }

      const payload = (await res.json()) as { space: Space; profile: Profile };
      const space = payload.space;
      const profile = payload.profile;

      saveLocalIdentity({ space, profile });
      await attachLocalDataToSpace(space.id, profile.id);
      await syncAttachedLocalData();
      setHasIdentity(true);
      router.push("/menu");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (hasIdentity || getLocalIdentity()) {
      setHasIdentity(true);
      setError("请先退出当前空间，再加入或创建新空间");
      return;
    }
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    if (!spaceName.trim()) {
      setError("请输入空间名称");
      return;
    }
    if (!user) {
      setError("请先登录账号");
      return;
    }
    setLoading(true);

    try {
      await seedDatabase();
      const res = await fetch(buildApiUrl("/spaces"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: spaceName.trim(),
          nickname: nickname.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "创建空间失败");
        setLoading(false);
        return;
      }

      const payload = (await res.json()) as { space: Space; profile: Profile };
      const space = payload.space;
      const profile = payload.profile;

      saveLocalIdentity({ space, profile });
      await attachLocalDataToSpace(space.id, profile.id);
      await syncAttachedLocalData();
      setHasIdentity(true);
      router.push("/menu");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const identity = getLocalIdentity();
    if (!identity) {
      clearLocalIdentity();
      setHasIdentity(false);
      return;
    }

    const confirmed = confirm(
      "确定要退出当前空间并重新加入吗？菜单、标签和模板会保留为本地数据；共享点赞和评论会被移除，当前空间下跟账号绑定的私有偏好不会转成本地模式。"
    );
    if (!confirmed) return;

    setLoading(true);
    setError("");
    try {
      await detachSpaceData(identity.space.id);
      clearLocalIdentity();
      setHasIdentity(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "退出当前空间失败");
    } finally {
      setLoading(false);
    }
  };

  const handleBindLocalProfile = async () => {
    const identity = getLocalIdentity();
    if (!identity || !user) return;
    setBindingLegacyProfile(true);
    setError("");
    try {
      await bindLocalProfile(identity.profile.id, identity.space.id);
      await refreshSession();
      setHasIdentity(true);
      router.push("/menu");
    } catch (err) {
      setError(err instanceof Error ? err.message : "绑定当前设备旧身份失败");
    } finally {
      setBindingLegacyProfile(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">加入共享菜单</h1>
          <p className="text-sm text-muted-foreground">
            登录账号后，输入邀请码加入朋友的空间，或创建一个新的共享空间。
          </p>
        </div>

        {!authLoading && !user && (
          <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
            需要先登录账号后才能加入或创建空间。
            <button
              onClick={() => router.push("/login?redirect=/join")}
              className="ml-2 underline font-medium"
            >
              去登录
            </button>
          </div>
        )}

        {hasIdentity && (
          <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
            你已经加入了一个空间。
            {user && !getLocalIdentity()?.profile.userId && (
              <button
                onClick={handleBindLocalProfile}
                disabled={bindingLegacyProfile}
                className="ml-2 underline font-medium"
              >
                {bindingLegacyProfile ? "绑定中…" : "绑定当前设备旧身份"}
              </button>
            )}
            <button onClick={handleReset} className="ml-2 underline font-medium">
              退出并重新加入
            </button>
          </div>
        )}

        <div className="flex rounded-lg border bg-muted p-1">
          <button
            onClick={() => setMode("join")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === "join" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            加入空间
          </button>
          <button
            onClick={() => setMode("create")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === "create" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            创建空间
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {mode === "join" ? (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">你的昵称</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="如：小厨神"
                maxLength={20}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">邀请码</label>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="如：EAT123"
                maxLength={10}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={loading || hasIdentity || !user}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "加入中…" : hasIdentity ? "请先退出当前空间" : !user ? "请先登录账号" : "加入空间"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">你的昵称</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="如：小厨神"
                maxLength={20}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">空间名称</label>
              <input
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                placeholder="如：咱们宿舍的菜单"
                maxLength={30}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={loading || hasIdentity || !user}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "创建中…" : hasIdentity ? "请先退出当前空间" : !user ? "请先登录账号" : "创建空间"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

import { reportSyncError } from "@/lib/error-monitor";

async function syncAttachedLocalData() {
  try {
    const result = await syncEngine.syncChanges();
    if (!result.success) {
      reportSyncError("Initial space sync did not fully complete", { error: result.error });
    }
  } catch (error) {
    reportSyncError("Initial space sync failed", { error: String(error) });
  }
}
