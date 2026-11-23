"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, usePathname } from "@/web/router";
import { APP_CONFIG } from "@/shared/constants/config";
import { NAV_GROUPS, NAV_ITEMS, isNavActive } from "@/shared/components/nav/navItems";
import { getPageInfo } from "@/shared/components/Header";
import ThemeToggle from "@/shared/components/ThemeToggle";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import HeaderMenu from "@/shared/components/HeaderMenu";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
import LogoMark from "./LogoMark";

const DESKTOP_QUERY = "(min-width: 1360px)";
const TABLET_OR_UP_QUERY = "(min-width: 640px)";

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

export default function TopBar({ onOpenMenu, menuOpen = false, onLogout = defaultLogout }) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, false);
  const isTabletOrUp = useMediaQuery(TABLET_OR_UP_QUERY, false);
  const isPhone = !isTabletOrUp;

  const headerRef = useRef(null);
  const navRef = useRef(null);
  const overflowedWidthRef = useRef(0);
  const [navOverflowed, setNavOverflowed] = useState(false);

  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const pageTitle = pageInfo.title ? translate(pageInfo.title) : APP_CONFIG.name;

  useEffect(() => {
    let cancelled = false;

    const checkOverflow = () => {
      if (cancelled) return;
      if (!isDesktop) {
        overflowedWidthRef.current = 0;
        setNavOverflowed(false);
        return;
      }
      const header = headerRef.current;
      const nav = navRef.current;
      if (nav) {
        if (nav.scrollWidth > nav.clientWidth) {
          overflowedWidthRef.current = header ? header.clientWidth : 0;
          setNavOverflowed(true);
        }
        return;
      }
      if (header && overflowedWidthRef.current > 0 && header.clientWidth > overflowedWidthRef.current) {
        overflowedWidthRef.current = 0;
        setNavOverflowed(false);
      }
    };

    queueMicrotask(checkOverflow);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(checkOverflow);
    if (navRef.current) observer.observe(navRef.current);
    if (headerRef.current) observer.observe(headerRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [isDesktop, navOverflowed]);

  const showInlineNav = isDesktop && !navOverflowed;
  const showMenuButton = !isPhone && !showInlineNav;

  return (
    <header
      ref={headerRef}
      className={cn(
        "sticky top-0 z-30 flex items-center border-b border-line",
        "h-12 gap-3 px-4 bg-bg",
        "sm:h-[52px] sm:gap-6 sm:px-8 sm:bg-bg/80 sm:backdrop-blur-[14px] sm:backdrop-saturate-[140%]",
      )}
    >
      <Link
        href="/dashboard"
        aria-label={`${APP_CONFIG.name} home`}
        className="flex shrink-0 items-center gap-2.5 text-[15px] font-bold tracking-[-0.01em] text-ink no-underline"
      >
        <LogoMark size={22} className="block shrink-0" />
        {!isPhone ? <span>{APP_CONFIG.name}</span> : null}
      </Link>

      {isPhone ? (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {pageTitle}
        </span>
      ) : null}

      {!isPhone && !showInlineNav ? (
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">
          {pageTitle}
        </span>
      ) : null}

      {showInlineNav ? (
        <nav
          ref={navRef}
          aria-label="Main"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
        >
          {NAV_GROUPS.map((group, groupIndex) => {
            const items = NAV_ITEMS.filter((item) => item.group === group.id);
            return (
              <Fragment key={group.id}>
                {groupIndex > 0 ? (
                  <span
                    aria-hidden="true"
                    className="mx-2 h-4 w-px shrink-0 bg-line-strong"
                  />
                ) : null}
                {items.map((item) => {
                  const active = isNavActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-[52px] shrink-0 items-center whitespace-nowrap px-2 text-[13.5px] no-underline transition-colors",
                        active
                          ? "font-semibold text-ink after:content-[''] after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-mark"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </Fragment>
            );
          })}
        </nav>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ThemeToggle />
        {!isPhone ? <HeaderLanguage /> : null}
        <HeaderMenu onLogout={onLogout} />
        {showMenuButton ? (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-expanded={menuOpen}
            aria-controls="nav-sheet"
            className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong px-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-raise"
          >
            Menu
          </button>
        ) : null}
      </div>
    </header>
  );
}
