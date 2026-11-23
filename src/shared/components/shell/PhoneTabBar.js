"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/web/router";
import { NAV_ITEMS, isNavActive } from "@/shared/components/nav/navItems";
import { cn } from "@/shared/utils/cn";

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.primary);

const EDITABLE_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

function isEditableInMain(el) {
  if (!el || typeof el.closest !== "function" || typeof el.matches !== "function") {
    return false;
  }
  if (!el.closest("main")) return false;
  return el.matches(EDITABLE_SELECTOR);
}

export default function PhoneTabBar({ onOpenMore, moreOpen = false }) {
  const pathname = usePathname();
  const [fieldFocused, setFieldFocused] = useState(false);

  useEffect(() => {
    const sync = (candidate) => {
      const target = candidate !== undefined ? candidate : document.activeElement;
      setFieldFocused(isEditableInMain(target));
    };

    const onFocusIn = (event) => sync(event.target);
    const onFocusOut = (event) => {
      if (event.relatedTarget) {
        sync(event.relatedTarget);
        return;
      }
      sync(document.activeElement === event.target ? null : document.activeElement);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    sync();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const moreActive = !PRIMARY_ITEMS.some((item) => isNavActive(item.href, pathname));

  return (
    <nav
      aria-label="Primary navigation"
      hidden={fieldFocused}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raise pb-[env(safe-area-inset-bottom)]",
        fieldFocused && "hidden",
      )}
    >
      <div className="flex h-[56px] items-stretch">
        {PRIMARY_ITEMS.map((item) => {
          const active = isNavActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 no-underline transition-colors",
                active ? "text-ink" : "text-muted",
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-[2px] bg-mark"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[22px] leading-none"
              >
                {item.icon}
              </span>
              <span className="max-w-full truncate text-[11px] font-medium leading-tight">
                {item.shortLabel}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenMore}
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? "nav-sheet" : undefined}
          aria-current={moreActive ? "page" : undefined}
          className={cn(
            "relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors",
            moreActive ? "text-ink" : "text-muted",
          )}
        >
          {moreActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-3 top-0 h-[2px] bg-mark"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[22px] leading-none"
          >
            more_horiz
          </span>
          <span className="max-w-full truncate text-[11px] font-medium leading-tight">
            More
          </span>
        </button>
      </div>
    </nav>
  );
}
