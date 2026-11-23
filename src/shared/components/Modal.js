"use client";

import { useEffect, useId, useRef } from "react";
import { getFocusable, nextTrapTarget } from "@/shared/utils/focusTrap";
import { useEscapeLayer, useScrollLock } from "@/shared/hooks/useEscapeLayer";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
    xxl: "max-w-6xl",
  };

  const isTopLayer = useEscapeLayer(isOpen, onClose);
  useScrollLock(isOpen);

  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const body = dialog.querySelector("[data-modal-body]");
      const target = getFocusable(body)[0] || getFocusable(dialog).find((el) => el.getAttribute("aria-label") !== "Close") || dialog;
      target.focus();
    }
    return () => {
      if (trigger && trigger.isConnected && typeof trigger.focus === "function") trigger.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key !== "Tab" || !dialogRef.current || !isTopLayer()) return;
      const target = nextTrapTarget(getFocusable(dialogRef.current), document.activeElement, e.shiftKey);
      if (target) { e.preventDefault(); target.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, isTopLayer]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 fade-in"
        onClick={closeOnOverlay ? onClose : undefined}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-raise outline-none",
          "border border-line-strong",
          "rounded-[10px] shadow-[var(--shadow-float)]",
          "fade-in",
          sizes[size] || sizes.md,
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
            <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}

        <div data-modal-body className="p-5 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-line">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} filled={variant === "danger"} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
