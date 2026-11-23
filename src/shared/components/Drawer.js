"use client";

import { useEscapeLayer, useScrollLock } from "@/shared/hooks/useEscapeLayer";
import { cn } from "@/shared/utils/cn";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className,
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  useEscapeLayer(isOpen, onClose);
  useScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/50 fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Drawer"}
        className={cn(
          "absolute right-0 top-0 h-full bg-raise flex flex-col",
          "shadow-[var(--shadow-float)]",
          "slide-in-right",
          "border-l border-line-strong",
          widths[width] || widths.md,
          className
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {title && (
              <h2 className="text-base font-semibold tracking-[-0.01em] text-ink truncate">{title}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
