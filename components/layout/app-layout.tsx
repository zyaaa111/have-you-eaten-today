"use client";

import { useEffect } from "react";
import { seedDatabase } from "@/lib/seed";
import { migrateLegacyClientImages } from "@/lib/menu-item-images";
import { migrateLegacyPrivateState, pullCurrentProfileState } from "@/lib/profile-state";
import { syncEngine } from "@/lib/sync-engine";
import { getLocalIdentity } from "@/lib/identity";
import { MobileNav } from "./mobile-nav";
import { DesktopNav } from "./desktop-nav";
import { useAuth } from "@/components/auth-provider";
import { reportSyncError } from "@/lib/error-monitor";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profiles, loading } = useAuth();
  const profileKey = profiles.map((membership) => membership.profile.id).join(",");

  useEffect(() => {
    if (loading) return;
    seedDatabase()
      .then(() => migrateLegacyPrivateState())
      .then(() => migrateLegacyClientImages())
      .catch((err) => reportSyncError("App layout migration failed", { error: String(err) }));
  }, [loading, user?.id, profileKey]);

  useEffect(() => {
    if (!user) return;
    let running = false;
    const syncAccountState = async () => {
      if (running) return;
      const identity = getLocalIdentity();
      if (!identity) return;
      running = true;
      try {
        await syncEngine.syncChanges();
        await pullCurrentProfileState();
      } finally {
        running = false;
      }
    };
    void syncAccountState().catch((err) => reportSyncError("App layout sync failed", { error: String(err) }));
    const timer = setInterval(() => {
      void syncAccountState().catch((err) => reportSyncError("App layout periodic sync failed", { error: String(err) }));
    }, 3_000);
    return () => clearInterval(timer);
  }, [user?.id, profileKey]);

  return (
    <div className="min-h-screen bg-background flex">
      <DesktopNav />
      <main className="flex-1 pb-20 md:pb-0 md:pl-64">
        <div className="max-w-5xl mx-auto p-4 md:p-6">{children}</div>
      </main>
      <MobileNav />
    </div>
  );
}
