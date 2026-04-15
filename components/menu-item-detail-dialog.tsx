"use client";

import { useMemo, useState, useEffect } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { db } from "@/lib/db";
import { MenuItem, TagType, ChangeLog } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { ChefHat, Bike, Pencil, Trash2, Heart, History, RotateCcw, X, Ban, ThumbsUp } from "lucide-react";
import { getWishIds, toggleWishId } from "@/lib/wishlist";
import { isAvoided, toggleAvoidance } from "@/lib/avoidances";
import { syncEngine } from "@/lib/sync-engine";
import { updateMenuItem } from "@/lib/space-ops";
import { getWeight } from "@/lib/weights";
import { buildMenuItemRestorePayload } from "@/lib/menu-item-sanitize";
import { toggleLike, isLikedByCurrentUser } from "@/lib/likes";
import { CommentSection } from "@/components/comment-section";

interface MenuItemDetailDialogProps {
  item: MenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (item: MenuItem) => void;
  onDelete?: (item: MenuItem) => void;
}

const typeLabels: Record<TagType, string> = {
  cuisine: "菜系",
  category: "类别",
  custom: "自定义",
};

const typeColors: Record<TagType, string> = {
  cuisine: "bg-amber-100 text-amber-700 border-amber-200",
  category: "bg-emerald-100 text-emerald-700 border-emerald-200",
  custom: "bg-slate-100 text-slate-700 border-slate-200",
};

export function MenuItemDetailDialog({
  item,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: MenuItemDetailDialogProps) {
  const allTags = useLiveQuery(() => db.tags.toArray(), []) || [];
  const [isWished, setIsWished] = useState(false);
  const [avoided, setAvoided] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [personalWeight, setPersonalWeight] = useState<number | undefined>(undefined);
  const [likeLoading, setLikeLoading] = useState(false);

  const likesCount = useLiveQuery(async () => {
    if (!item) return 0;
    return db.likes.where("menuItemId").equals(item.id).count();
  }, [item?.id]) ?? 0;

  const isLiked = useLiveQuery(async () => {
    if (!item) return false;
    return isLikedByCurrentUser(item.id);
  }, [item?.id]) ?? false;

  useEffect(() => {
    if (open && item) {
      getWishIds().then((ids) => setIsWished(ids.includes(item.id)));
      isAvoided(item.id).then(setAvoided);
      getWeight(item.id).then(setPersonalWeight);
      setShowHistory(false);
      setLogs([]);
      setHistoryError("");
    }
  }, [open, item]);

  useEffect(() => {
    let active = true;

    if (showHistory && item) {
      setLoadingLogs(true);
      setHistoryError("");

      void (async () => {
        try {
          const data = await syncEngine.fetchChangeLogsForRecord("menu_items", item.id);
          if (!active) return;
          setLogs(data);
        } catch (error) {
          if (!active) return;
          setLogs([]);
          setHistoryError("历史记录加载失败，请稍后再试。");
          console.error("Menu item history load failed:", error);
        } finally {
          if (active) {
            setLoadingLogs(false);
          }
        }
      })();
    } else {
      setLoadingLogs(false);
      setHistoryError("");
    }

    return () => {
      active = false;
    };
  }, [showHistory, item]);

  const handleToggleWish = async () => {
    if (!item) return;
    const wished = await toggleWishId(item.id);
    setIsWished(wished);
  };

  const handleToggleLike = async () => {
    if (!item) return;
    setLikeLoading(true);
    try {
      await toggleLike(item.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "操作失败");
    } finally {
      setLikeLoading(false);
    }
  };

  const handleRestore = async (snapshot: Record<string, unknown>) => {
    if (!item) return;
    const ok = confirm(`确定恢复到此版本吗？当前版本将被覆盖，但也会保留在历史记录中。`);
    if (!ok) return;
    const restored = buildMenuItemRestorePayload(snapshot);
    await updateMenuItem(item.id, {
      ...restored,
      updatedAt: Date.now(),
    } as Partial<MenuItem>);
    setShowHistory(false);
  };

  const itemTags = useMemo(() => {
    if (!item) return [];
    return item.tags
      .map((id) => allTags.find((t) => t.id === id))
      .filter(Boolean) as typeof allTags;
  }, [item, allTags]);

  if (!item) return null;

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={item.name}
      footer={
        <>
          {!showHistory && (
            <>
              <button
                onClick={() => onDelete?.(item)}
                className="flex-1 min-w-[72px] justify-center rounded-md border border-destructive px-2 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 sm:flex-initial sm:px-4 sm:py-2 sm:text-sm"
              >
                <Trash2 className="w-4 h-4 inline-block mr-1 align-text-bottom" />
                删除
              </button>
              <button
                onClick={handleToggleWish}
                className={`flex-1 min-w-[72px] justify-center rounded-md border px-2 py-2 text-xs font-medium transition sm:flex-initial sm:px-4 sm:py-2 sm:text-sm ${
                  isWished
                    ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <Heart className={`w-4 h-4 inline-block mr-1 align-text-bottom ${isWished ? "fill-current" : ""}`} />
                想吃
              </button>
              <button
                onClick={handleToggleLike}
                disabled={likeLoading}
                className={`flex-1 min-w-[72px] min-h-[44px] justify-center rounded-md border px-2 py-2 text-xs font-medium transition-transform active:scale-95 sm:flex-initial sm:px-4 sm:py-2 sm:text-sm ${
                  isLiked
                    ? "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <ThumbsUp className={`w-4 h-4 inline-block mr-1 align-text-bottom ${isLiked ? "fill-current" : ""}`} />
                {likesCount > 0 ? likesCount : "赞"}
              </button>
              <button
                onClick={async () => {
                  if (!item) return;
                  const next = await toggleAvoidance(item.id);
                  setAvoided(next);
                }}
                className={`flex-1 min-w-[72px] justify-center rounded-md border px-2 py-2 text-xs font-medium transition sm:flex-initial sm:px-4 sm:py-2 sm:text-sm ${
                  avoided
                    ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <Ban className={`w-4 h-4 inline-block mr-1 align-text-bottom ${avoided ? "fill-current" : ""}`} />
                {avoided ? "取消忌口" : "忌口"}
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className="flex-1 min-w-[72px] justify-center rounded-md border bg-background px-2 py-2 text-xs font-medium hover:bg-muted sm:flex-initial sm:px-4 sm:py-2 sm:text-sm"
              >
                <History className="w-4 h-4 inline-block mr-1 align-text-bottom" />
                历史版本
              </button>
              <button
                onClick={() => onEdit?.(item)}
                className="flex-1 min-w-[72px] justify-center rounded-md border bg-background px-2 py-2 text-xs font-medium hover:bg-muted sm:flex-initial sm:px-4 sm:py-2 sm:text-sm"
              >
                <Pencil className="w-4 h-4 inline-block mr-1 align-text-bottom" />
                编辑
              </button>
            </>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 min-w-[72px] justify-center rounded-md bg-primary px-2 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 sm:flex-initial sm:px-4 sm:py-2 sm:text-sm"
          >
            {showHistory ? "关闭" : "关闭"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {!showHistory ? (
          <>
            {item.imageUrl && item.kind === "recipe" && (
              <div className="-mx-5 -mt-5 mb-2 overflow-hidden">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-full max-h-80 object-contain"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border ${
                  item.kind === "recipe"
                    ? "bg-orange-50 text-orange-700 border-orange-200"
                    : "bg-blue-50 text-blue-700 border-blue-200"
                }`}
              >
                {item.kind === "recipe" ? (
                  <>
                    <ChefHat className="w-3.5 h-3.5" /> 菜谱
                  </>
                ) : (
                  <>
                    <Bike className="w-3.5 h-3.5" /> 外卖
                  </>
                )}
              </span>
              <span className="text-xs text-muted-foreground">权重 {personalWeight ?? "—"}</span>
            </div>

            {itemTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {itemTags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${typeColors[tag.type]}`}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {item.kind === "recipe" ? (
              <>
                {item.ingredients && item.ingredients.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">材料</h4>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {item.ingredients.map((ing, idx) => (
                        <li
                          key={idx}
                          className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
                        >
                          <span>{ing.name}</span>
                          {ing.amount && (
                            <span className="text-muted-foreground text-xs">{ing.amount}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {item.steps && item.steps.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">步骤</h4>
                    <ol className="space-y-3">
                      {item.steps.map((step) => (
                        <li key={step.order} className="flex gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                            {step.order}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm leading-relaxed">{step.description}</p>
                            {typeof step.durationMinutes === "number" && (
                              <p className="text-xs text-muted-foreground mt-1">
                                ⏱ {step.durationMinutes} 分钟
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {item.tips && (
                  <div className="rounded-md bg-amber-50 border border-amber-100 p-3">
                    <h4 className="text-sm font-semibold text-amber-800 mb-1">心得</h4>
                    <p className="text-sm text-amber-900">{item.tips}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">店铺</span>
                    <span className="font-medium">{item.shop || "—"}</span>
                  </div>
                  {item.shopAddress && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">地址</span>
                      <span className="font-medium">{item.shopAddress}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Comment Section */}
            <div className="border-t pt-4 mt-4">
              <CommentSection menuItemId={item.id} />
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <History className="w-4 h-4" />
                历史版本
              </h4>
              <button
                onClick={() => setShowHistory(false)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                返回详情
              </button>
            </div>
            {loadingLogs ? (
              <div className="text-sm text-muted-foreground">加载中…</div>
            ) : historyError ? (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{historyError}</div>
            ) : logs.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无历史记录</div>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {log.operation === "create" && "创建"}
                        {log.operation === "update" && "修改"}
                        {log.operation === "delete" && "删除"}
                        {log.actorNickname && ` · ${log.actorNickname}`}
                      </span>
                      <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                    {log.operation === "update" && log.beforeSnapshot && (
                      <button
                        onClick={() => handleRestore(log.beforeSnapshot!)}
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        恢复到此版本
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
