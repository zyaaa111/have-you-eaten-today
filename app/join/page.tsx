"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousUser, saveLocalIdentity, getLocalIdentity, generateInviteCode } from "@/lib/supabase";
import { db } from "@/lib/db";
import type { Space, Profile } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function JoinPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasIdentity, setHasIdentity] = useState(false);

  useEffect(() => {
    const identity = getLocalIdentity();
    setHasIdentity(!!identity);
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    setLoading(true);

    try {
      const { userId, error: authErr } = await ensureAnonymousUser();
      if (authErr || !userId) {
        setError(authErr?.message || "匿名登录失败");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/spaces/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: inviteCode.trim().toUpperCase(),
          nickname: nickname.trim(),
          user_id: userId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "加入空间失败");
        setLoading(false);
        return;
      }

      const spaceData = (await res.json()) as Space;
      const space: Space = {
        id: spaceData.id,
        inviteCode: spaceData.inviteCode,
        name: spaceData.name,
        createdAt: spaceData.createdAt,
        updatedAt: spaceData.createdAt,
      };
      const profile: Profile = {
        id: userId,
        spaceId: space.id,
        nickname: nickname.trim(),
        joinedAt: Date.now(),
      };

      saveLocalIdentity({ space, profile });
      await migrateLocalDataToSpace(space.id, userId);
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
    if (!nickname.trim()) {
      setError("请输入昵称");
      return;
    }
    if (!spaceName.trim()) {
      setError("请输入空间名称");
      return;
    }
    setLoading(true);

    try {
      const { userId, error: authErr } = await ensureAnonymousUser();
      if (authErr || !userId) {
        setError(authErr?.message || "匿名登录失败");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/spaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: spaceName.trim(),
          nickname: nickname.trim(),
          user_id: userId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "创建空间失败");
        setLoading(false);
        return;
      }

      const spaceData = (await res.json()) as Space;
      const space: Space = {
        id: spaceData.id,
        inviteCode: spaceData.inviteCode,
        name: spaceData.name,
        createdAt: spaceData.createdAt,
        updatedAt: spaceData.createdAt,
      };
      const profile: Profile = {
        id: userId,
        spaceId: space.id,
        nickname: nickname.trim(),
        joinedAt: Date.now(),
      };

      saveLocalIdentity({ space, profile });
      await migrateLocalDataToSpace(space.id, userId);
      router.push("/menu");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (!confirm("确定要退出当前空间并重新加入吗？本地数据不会丢失。")) return;
    localStorage.removeItem("hyet_profile_v1");
    localStorage.removeItem("hyet_space_v1");
    setHasIdentity(false);
  };

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">加入共享菜单</h1>
          <p className="text-sm text-muted-foreground">
            输入邀请码加入朋友的空间，或创建一个新的共享空间。
          </p>
        </div>

        {hasIdentity && (
          <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
            你已经加入了一个空间。
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
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "加入中…" : "加入空间"}
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
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "创建中…" : "创建空间"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

async function migrateLocalDataToSpace(spaceId: string, profileId: string) {
  await db.menuItems.toCollection().modify((item) => {
    if (!item.spaceId) {
      item.spaceId = spaceId;
      item.profileId = profileId;
      item.syncStatus = "pending";
    }
  });
  await db.tags.toCollection().modify((item) => {
    if (!item.spaceId) {
      item.spaceId = spaceId;
      item.profileId = profileId;
      item.syncStatus = "pending";
    }
  });
  await db.comboTemplates.toCollection().modify((item) => {
    if (!item.spaceId) {
      item.spaceId = spaceId;
      item.profileId = profileId;
      item.syncStatus = "pending";
    }
  });
}
