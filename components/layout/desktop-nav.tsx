"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UtensilsCrossed, Tag, Layers, History, Settings, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/menu", label: "菜单", icon: UtensilsCrossed },
  { href: "/tags", label: "标签", icon: Tag },
  { href: "/templates", label: "模板", icon: Layers },
  { href: "/groups", label: "清单", icon: FolderOpen },
  { href: "/history", label: "历史", icon: History },
  { href: "/settings", label: "设置", icon: Settings },
];

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 border-r bg-background hidden md:flex flex-col z-40">
      <div className="p-6">
        <h1 className="text-xl font-bold">今天吃了吗</h1>
        <p className="text-xs text-muted-foreground mt-1">随机决定今天吃什么</p>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 text-xs text-muted-foreground border-t">
        本地私有数据 + 共享空间同步，请定期导出 ZIP 备份
      </div>
    </aside>
  );
}
