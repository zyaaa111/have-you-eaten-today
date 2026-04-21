"use client";

import { useEffect } from "react";
import { seedDatabase } from "@/lib/seed";
import { migrateLegacyClientImages } from "@/lib/menu-item-images";
import { migrateLegacyPrivateState, pullCurrentProfileState } from "@/lib/profile-state";
import { MobileNav } from "./mobile-nav";
import { DesktopNav } from "./desktop-nav";
import { useAuth } from "@/components/auth-provider";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    seedDatabase()
      .then(() => migrateLegacyPrivateState())
      .then(() => migrateLegacyClientImages())
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!user) return;
    void pullCurrentProfileState().catch(console.error);
    const timer = setInterval(() => {
      void pullCurrentProfileState().catch(console.error);
    }, 10_000);
    return () => clearInterval(timer);
  }, [user?.id]);

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
