"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link, usePathname } from "@/web/router";
import { NAV_GROUPS, NAV_ITEMS, isNavActive } from "@/shared/components/nav/navItems";
import { getFocusable, nextTrapTarget } from "@/shared/utils/focusTrap";
import { useEscapeLayer, useScrollLock } from "@/shared/hooks/useEscapeLayer";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { cn } from "@/shared/utils/cn";

const SWIPE_CLOSE_THRESHOLD = 64;

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

async function defaultLogout() {
  try {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (res.ok) {
      window.location.assign("/login");
    }
  } catch (err) {
    console.error("Failed to logout:", err);
  }
}

export default function NavSheet({ open, onClose, variant = "full", onLogout = defaultLogout }) {
  const pathname = usePathname();
  const titleId = useId();
  const dialogRef = useRef(null);
  const prevPathRef = useRef(pathname);
  const dragStartYRef = useRef(null);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [locale, setLocale] = useState(getLocaleFromCookie);

  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const isTopLayer = useEscapeLayer(open, onClose);
  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      dragStartYRef.current = null;
      dragOffsetRef.current = 0;
    }
  }, [open]);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      if (open) onClose();
    }
  }, [pathname, open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const target = getFocusable(dialog)[0] || dialog;
      target.focus();
    }
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Tab" || !dialogRef.current || !isTopLayer()) return;
      const target = nextTrapTarget(
        getFocusable(dialogRef.current),
        document.activeElement,
        event.shiftKey,
      );
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isTopLayer]);

  const startDrag = (clientY) => {
    if (variant !== "bottom") return;
    dragStartYRef.current = clientY;
    dragOffsetRef.current = 0;
    setDragging(true);
    setDragOffset(0);
  };

  const moveDrag = (clientY) => {
    if (dragStartYRef.current === null) return;
    const delta = Math.max(0, clientY - dragStartYRef.current);
    dragOffsetRef.current = delta;
    setDragOffset(delta);
  };

  const endDrag = (clientY) => {
    if (dragStartYRef.current === null) return;
    const finalDelta =
      typeof clientY === "number"
        ? Math.max(dragOffsetRef.current, clientY - dragStartYRef.current)
        : dragOffsetRef.current;
    dragStartYRef.current = null;
    dragOffsetRef.current = 0;
    setDragging(false);
    setDragOffset(0);
    if (finalDelta >= SWIPE_CLOSE_THRESHOLD) {
      onClose();
    }
  };

  const isInteractiveTarget = (target) =>
    Boolean(target && typeof target.closest === "function" && target.closest("button, a, input, select, textarea"));

  const handlePointerDown = (event) => {
    if (isInteractiveTarget(event.target)) return;
    startDrag(event.clientY);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  };

  const handlePointerMove = (event) => {
    if (dragStartYRef.current === null) return;
    moveDrag(event.clientY);
  };

  const handlePointerUp = (event) => {
    if (dragStartYRef.current === null) return;
    endDrag(event.clientY);
  };

  const handleTouchStart = (event) => {
    if (isInteractiveTarget(event.target)) return;
    const touch = event.touches?.[0];
    if (touch) startDrag(touch.clientY);
  };

  const handleTouchMove = (event) => {
    const touch = event.touches?.[0];
    if (touch) moveDrag(touch.clientY);
  };

  const handleTouchEnd = (event) => {
    const touch = event.changedTouches?.[0];
    endDrag(touch?.clientY);
  };

  if (!open) return null;

  const isBottom = variant === "bottom";

  const dialogContent = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={
        isBottom && dragOffset > 0
          ? { transform: `translateY(${dragOffset}px)`, transition: dragging ? "none" : undefined }
          : undefined
      }
      className={cn(
        "relative flex flex-col bg-raise text-ink outline-none shadow-[var(--shadow-float)]",
        isBottom
          ? cn(
              "w-full max-h-[85vh] rounded-t-[10px] border-t border-line-strong pb-[env(safe-area-inset-bottom)]",
              !prefersReducedMotion && !dragging && "transition-transform duration-200 ease-out",
            )
          : "h-full w-full max-w-[520px] border-l border-line-strong",
      )}
    >
      <div
        data-sheet-handle={isBottom ? "" : undefined}
        onPointerDown={isBottom ? handlePointerDown : undefined}
        onPointerMove={isBottom ? handlePointerMove : undefined}
        onPointerUp={isBottom ? handlePointerUp : undefined}
        onPointerCancel={isBottom ? handlePointerUp : undefined}
        onTouchStart={isBottom ? handleTouchStart : undefined}
        onTouchMove={isBottom ? handleTouchMove : undefined}
        onTouchEnd={isBottom ? handleTouchEnd : undefined}
        onTouchCancel={isBottom ? handleTouchEnd : undefined}
        className={cn(
          "shrink-0 border-b border-line",
          isBottom && "min-h-[44px] cursor-grab touch-none select-none active:cursor-grabbing",
        )}
      >
        {isBottom ? (
          <div className="flex justify-center pt-3 pb-1">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line-strong" />
          </div>
        ) : null}

        <div className="flex items-center justify-between px-4 py-2.5">
          <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-ink">
            All pages
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
              close
            </span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <nav aria-label="All pages" className="pb-2">
          {NAV_GROUPS.map((group) => {
            const items = NAV_ITEMS.filter((item) => item.group === group.id);
            return (
              <div key={group.id} className="pt-3 first:pt-2">
                <p className="px-4 pb-1 text-xs font-semibold text-faint">
                  {group.label}
                </p>
                {items.map((item) => {
                  const active = isNavActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-[48px] items-center gap-3 border-b border-line border-l-[3px] px-4 text-[15px] no-underline transition-colors",
                        active
                          ? "border-l-mark bg-bg-alt/60 font-semibold text-ink"
                          : "border-l-transparent text-muted hover:bg-bg-alt/40 hover:text-ink",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[20px]"
                      >
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="mt-2 border-t border-line-strong">
          <button
            type="button"
            onClick={() => setLangOpen(true)}
            data-i18n-skip="true"
            className="flex min-h-[48px] w-full items-center gap-3 border-b border-line px-4 text-left text-[15px] text-ink transition-colors hover:bg-bg-alt/40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-muted">
              language
            </span>
            <span className="flex-1">Language</span>
            <span className="text-base leading-none">{LOCALE_FLAGS[locale] || "🌐"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[15px] text-danger transition-colors hover:bg-danger/10"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
              logout
            </span>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      id="nav-sheet"
      className={cn(
        "fixed inset-0 z-[50] flex",
        isBottom ? "items-end justify-center" : "justify-end",
      )}
    >
      <div
        data-sheet-backdrop
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {isBottom ? (
        <div className={cn("relative w-full", !prefersReducedMotion && "sheet-slide-up")}>
          {dialogContent}
        </div>
      ) : (
        dialogContent
      )}

      <LanguageSwitcher
        hideTrigger
        isOpen={langOpen}
        onClose={(next) => {
          setLangOpen(false);
          if (next) setLocale(next);
        }}
      />
    </div>
  );
}
