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
}

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 flex flex-col w-full max-w-2xl max-h-[85dvh] rounded-2xl border bg-background shadow-lg",
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between shrink-0 px-5 py-4 border-b">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 px-5 py-4 border-t bg-muted/30 flex justify-end gap-2 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
