"use client";

import { useEffect, useId, useRef } from "react";
import { getFocusable, nextTrapTarget } from "@/shared/utils/focusTrap";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import Tooltip from "./Tooltip";

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showTrafficLights = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const titleId = useId();
  const dialogRef = useRef(null);

  // Initial focus + restore focus to the trigger on close.
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
    const handleKey = (e) => {
      if (!isOpen) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const target = nextTrapTarget(getFocusable(dialogRef.current), document.activeElement, e.shiftKey);
      if (target) { e.preventDefault(); target.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] fade-in"
        onClick={closeOnOverlay ? onClose : undefined}
      />

      {/* Modal content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-surface outline-none",
          "border border-border-subtle",
          "rounded-[14px] shadow-[var(--shadow-elev)]",
          "fade-in",
          sizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showTrafficLights) && (
          <div className="flex items-center justify-between p-2 border-b border-border-subtle">
            <div className="flex items-center">
              {/* Traffic lights — desktop only */}
              {showTrafficLights && (
                <div className="hidden md:flex items-center gap-2 mr-4 ml-2">
                  <Tooltip text="Close" position="top" color="#FF5F56">
                    <button
                      onClick={onClose}
                      aria-label="Close"
                      title="Close"
                      className="size-4 rounded-full bg-[#FF5F56] hover:brightness-90 transition-[filter] cursor-pointer flex items-center justify-center group/dot"
                    >
                      <span className="text-[9px] font-bold text-white opacity-0 group-hover/dot:opacity-100 transition-opacity leading-none">✕</span>
                    </button>
                  </Tooltip>
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                </div>
              )}
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-text-main">{title}</h2>
              )}
            </div>
            {/* X button — mobile only */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="md:hidden p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div data-modal-body className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border-subtle">
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
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
