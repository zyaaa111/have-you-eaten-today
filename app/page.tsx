"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChefHat, Bike, Dices, ShoppingBasket } from "lucide-react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { MenuItem, RolledItem } from "@/lib/types";
import { MenuItemDetailDialog } from "@/components/menu-item-detail-dialog";
import { IngredientSummaryDialog } from "@/components/ingredient-summary-dialog";
import { getLocalIdentity } from "@/lib/identity";
import { getRecommendations } from "@/lib/recommendations";
import { getFavoriteIds } from "@/lib/favorites";
import { useAuth } from "@/components/auth-provider";

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
  const { user } = useAuth();
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [identity, setIdentity] = useState<ReturnType<typeof getLocalIdentity>>(null);
  const [ingredientItems, setIngredientItems] = useState<RolledItem[] | null>(null);
  const [ingredientRolledAt, setIngredientRolledAt] = useState(0);
  const [ingredientOpen, setIngredientOpen] = useState(false);

  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];
  const latestHistory = useLiveQuery(
    () => db.rollHistory.orderBy("rolledAt").reverse().first(),
    []
  );
  const favoriteIds = useLiveQuery(() => getFavoriteIds(), [identity?.profile.id]) ?? [];
  const recommendations = useLiveQuery(() => getRecommendations({ limit: 4 }), [latestHistory?.rolledAt]) ?? [];

  const firstItem = latestHistory?.items[0];
  const favoriteItems = menuItems.filter((item) => favoriteIds.includes(item.id)).slice(0, 4);

  useEffect(() => {
    setIdentity(getLocalIdentity());
  }, [user?.id]);

  const handleItemClick = async (menuItemId: string, name: string) => {
    const item = await db.menuItems.get(menuItemId);
    if (item) {
      setDetailItem(item);
      setDetailOpen(true);
    } else {
      alert(`「${name}」已被删除`);
    }
  };

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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setIngredientItems(latestHistory.items);
                    setIngredientRolledAt(latestHistory.rolledAt);
                    setIngredientOpen(true);
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <ShoppingBasket className="w-4 h-4" />
                  材料清单
                </button>
                <Link
                  href={`/random?kind=${firstItem.kind}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <Dices className="w-4 h-4" />
                  再抽一次
                </Link>
              </div>
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
                  {latestHistory.items.map((i, idx) => (
                    <span key={i.menuItemId}>
                      {idx > 0 && "、"}
                      <button
                        onClick={() => handleItemClick(i.menuItemId, i.name)}
                        className="text-primary underline decoration-primary/30 underline-offset-4 active:opacity-70 transition-opacity hover:text-primary/80"
                      >
                        {i.name}
                      </button>
                    </span>
                  ))}
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

      {recommendations.length > 0 && (
        <section className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">今日推荐</h3>
            <Link href="/random" className="text-sm font-medium text-primary hover:underline">
              去随机页
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recommendations.map(({ item, reasons, score }) => (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id, item.name)}
                className="rounded-xl border bg-card p-4 text-left shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.kind === "recipe" ? "菜谱" : item.shop || "外卖"}
                    </div>
                  </div>
                  <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {score.toFixed(1)}
                  </div>
                </div>
                {reasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {reasons.slice(0, 3).map((reason) => (
                      <span key={reason} className="rounded-full border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {favoriteItems.length > 0 && (
        <section className="max-w-4xl mx-auto space-y-3">
          <h3 className="text-lg font-semibold">我的收藏</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {favoriteItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id, item.name)}
                className="rounded-xl border bg-card p-4 text-left shadow-sm hover:bg-muted/30 transition"
              >
                <div className="font-semibold">{item.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {item.kind === "recipe" ? "菜谱" : item.shop || "外卖"}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-2xl mx-auto">
        <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          {identity && user ? (
            <p>💡 提示：你正在使用共享空间数据；菜单与互动会同步到本地后端服务，其他成员可以看到你的共享操作。</p>
          ) : identity ? (
            <p>💡 提示：当前设备仍保留共享空间指针，但你已经退出账号登录；重新登录后才能继续访问和同步共享空间数据。</p>
          ) : (
            <p>💡 提示：你当前使用的是本地私有数据模式；菜单和偏好保存在本机，请定期到「设置」中导出备份。</p>
          )}
        </div>
      </section>

      <MenuItemDetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      <IngredientSummaryDialog
        open={ingredientOpen}
        onClose={() => setIngredientOpen(false)}
        items={ingredientItems ?? []}
        rolledAt={ingredientRolledAt}
      />
    </div>
  );
}
