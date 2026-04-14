"use client";

import { useMemo } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { removeAvoidance } from "@/lib/avoidances";
import { TagType } from "@/lib/types";
import { ChefHat, Bike, Ban, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

const typeColors: Record<TagType, string> = {
  cuisine: "bg-amber-100 text-amber-700 border-amber-200",
  category: "bg-emerald-100 text-emerald-700 border-emerald-200",
  custom: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function AvoidancesPage() {
  const router = useRouter();
  const menuItems = useLiveQuery(() => db.menuItems.toArray(), []) || [];
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const avoidances = useLiveQuery(() => db.avoidances.toArray(), []) || [];

  const avoidedIds = useMemo(() => new Set(avoidances.map((a) => a.menuItemId)), [avoidances]);

  const avoidedItems = useMemo(() => {
    return menuItems.filter((item) => avoidedIds.has(item.id));
  }, [menuItems, avoidedIds]);

  const tagMap = useMemo(() => {
    const map = new Map<string, typeof allTags[number]>();
    allTags.forEach((t) => map.set(t.id, t));
    return map;
  }, [allTags]);

  const handleRemove = async (id: string) => {
    await removeAvoidance(id);
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </button>
        <h2 className="text-xl font-bold">我的忌口</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        以下菜品在随机抽取时会被自动排除。点击「取消忌口」可恢复参与随机。
      </p>

      {avoidedItems.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <p className="text-muted-foreground">当前没有忌口菜品</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {avoidedItems.map((item) => {
            const itemTags = item.tags
              .map((id) => tagMap.get(id))
              .filter(Boolean) as typeof allTags;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.kind === "recipe" ? (
                      <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <ChefHat className="w-3.5 h-3.5 text-orange-600" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Bike className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                    )}
                    <div className="font-medium truncate">{item.name}</div>
                  </div>
                  {itemTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {itemTags.slice(0, 4).map((tag) => (
                        <span
                          key={tag.id}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${typeColors[tag.type]}`}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {itemTags.length > 4 && (
                        <span className="rounded-full border px-2 py-0.5 text-[10px] bg-background text-muted-foreground">
                          +{itemTags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
                >
                  <Ban className="w-4 h-4" />
                  取消忌口
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
