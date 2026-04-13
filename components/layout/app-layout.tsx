"use client";

import { useEffect } from "react";
import { seedDatabase } from "@/lib/seed";
import { MobileNav } from "./mobile-nav";
import { DesktopNav } from "./desktop-nav";

export function AppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    seedDatabase().catch(console.error);
  }, []);

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
