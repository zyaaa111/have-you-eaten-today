"use client";

import Link from "next/link";
import { ChefHat, Bike, Dices } from "lucide-react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

export default function Home() {
  const latestHistory = useLiveQuery(
    () => db.rollHistory.orderBy("rolledAt").reverse().first(),
    []
  );

  const firstItem = latestHistory?.items[0];

  return (
    <div className="space-y-8">
      <section className="text-center py-8 md:py-12">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">今天吃什么？</h2>
        <p className="text-muted-foreground">让随机来帮你做决定</p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
        <Link
          href="/random?kind=recipe"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-8 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
            <ChefHat className="w-7 h-7 text-orange-600" />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">随机做菜</div>
            <div className="text-sm text-muted-foreground">从菜谱中抽取今日菜单</div>
          </div>
        </Link>

        <Link
          href="/random?kind=takeout"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-8 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
            <Bike className="w-7 h-7 text-blue-600" />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">随机外卖</div>
            <div className="text-sm text-muted-foreground">从外卖清单中抽取</div>
          </div>
        </Link>
      </section>

      {latestHistory && firstItem && (
        <section className="max-w-2xl mx-auto">
          <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">
                最近抽中 · {relativeTime(latestHistory.rolledAt)}
              </div>
              <Link
                href={`/random?kind=${firstItem.kind}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <Dices className="w-4 h-4" />
                再抽一次
              </Link>
            </div>

            <div
              className={cn(
                "flex items-center gap-4 rounded-lg border p-4",
                firstItem.kind === "recipe"
                  ? "bg-orange-50/50 border-orange-100"
                  : "bg-blue-50/50 border-blue-100"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                  firstItem.kind === "recipe" ? "bg-orange-100" : "bg-blue-100"
                )}
              >
                {firstItem.kind === "recipe" ? (
                  <ChefHat className="w-5 h-5 text-orange-600" />
                ) : (
                  <Bike className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {latestHistory.items.map((i) => i.name).join("、")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {latestHistory.ruleSnapshot}
                  {firstItem.shop && <span className="ml-2">· {firstItem.shop}</span>}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="max-w-2xl mx-auto">
        <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          <p>💡 提示：你的所有数据都保存在浏览器本地，请定期到「设置」中导出备份。</p>
        </div>
      </section>
    </div>
  );
}
