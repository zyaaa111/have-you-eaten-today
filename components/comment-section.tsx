"use client";

import { useState, useRef, useEffect } from "react";
import { useLiveQuery } from "@/lib/use-live-query";
import { getCommentsByMenuItem, addComment, deleteComment } from "@/lib/comments";
import { getCurrentProfileId, hasSpace } from "@/lib/space-ops";
import { Trash2, MessageCircle, Send } from "lucide-react";

interface CommentSectionProps {
  menuItemId: string;
}

export function CommentSection({ menuItemId }: CommentSectionProps) {
  const [content, setContent] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentProfileId(getCurrentProfileId());
  }, []);

  const comments = useLiveQuery(
    () => getCommentsByMenuItem(menuItemId),
    [menuItemId]
  ) ?? [];

  const canInteract = hasSpace();

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(menuItemId, trimmed, isAnonymous);
      setContent("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "评论失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("确定删除这条评论？")) return;
    try {
      await deleteComment(commentId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <MessageCircle className="w-4 h-4" />
        评论 ({comments.length})
      </h4>

      {/* Comment list */}
      <div
        ref={listRef}
        className="space-y-2 max-h-[40vh] overflow-y-auto"
      >
        {comments.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">暂无评论，快来抢沙发~</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="rounded-lg border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground">
                {c.nickname}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatTime(c.createdAt)}</span>
                {c.profileId === currentProfileId && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm mt-1 leading-relaxed">{c.content}</p>
          </div>
        ))}
      </div>

      {/* Input area */}
      {canInteract && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="写评论..."
              className="flex-1 min-h-[44px] rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || submitting}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50 transition active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 cursor-pointer select-none">
            <button
              role="switch"
              aria-checked={isAnonymous}
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                isAnonymous ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isAnonymous ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-xs text-muted-foreground">匿名评论</span>
          </div>
        </div>
      )}
    </div>
  );
}
