"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  fullScreen?: boolean;
}

export function Modal({ open, onClose, title, children, footer, className, fullScreen }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex flex-col w-full border bg-background shadow-lg",
          fullScreen
            ? "rounded-none sm:rounded-2xl inset-0 sm:inset-auto sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[85dvh]"
            : "max-w-2xl max-h-[80dvh] sm:max-h-[85dvh] rounded-2xl",
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between shrink-0 px-5 py-4 border-b">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 px-5 py-4">{children}</div>
        {footer && (
          <div className={cn(
            "shrink-0 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t bg-muted/30 flex flex-wrap justify-center sm:justify-end gap-2",
            fullScreen ? "rounded-none sm:rounded-b-2xl" : "rounded-b-2xl"
          )}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
