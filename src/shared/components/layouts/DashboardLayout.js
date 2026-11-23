"use client";

import { useRef, useState } from "react";
import { useScrollReset } from "@/web/router";
import { useNotificationStore } from "@/store/notificationStore";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import TopBar from "../shell/TopBar";
import NavSheet from "../shell/NavSheet";
import PhoneTabBar from "../shell/PhoneTabBar";
import UpdateBanner from "../shell/UpdateBanner";

const TABLET_OR_UP_QUERY = "(min-width: 640px)";

async function handleLogout() {
  try {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (res.ok) {
      window.location.assign("/login");
    }
  } catch (err) {
    console.error("Failed to logout:", err);
  }
}

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-l-ok",
      iconClass: "text-ok",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-l-danger",
      iconClass: "text-danger",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-l-warning",
      iconClass: "text-warning",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-l-ink",
    iconClass: "text-muted",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isTabletOrUp = useMediaQuery(TABLET_OR_UP_QUERY, false);
  const isPhone = !isTabletOrUp;
  const scrollRef = useRef(null);
  useScrollReset(scrollRef);
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="dashboard-backdrop h-[100dvh] w-full overflow-hidden [padding:env(safe-area-inset-top)_env(safe-area-inset-right)_0_env(safe-area-inset-left)]">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-ink px-3 py-2 text-sm font-semibold text-bg focus:not-sr-only"
      >
        Skip to content
      </a>

      <div
        className="pointer-events-none fixed inset-x-4 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] z-[80] flex flex-col gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:w-[min(92vw,380px)]"
        aria-live="polite"
      >
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`pointer-events-auto rounded-md border border-line-strong border-l-[3px] bg-raise px-3 py-2.5 text-ink shadow-[var(--shadow-float)] ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] leading-5 ${style.iconClass}`}>
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="mb-0.5 text-xs font-semibold text-ink">{n.title}</p> : null}
                  <p className="whitespace-pre-wrap break-words text-xs text-muted">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                    aria-label="Dismiss notification"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <main
        id="main-content"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg transition-colors duration-300"
      >
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <TopBar
            onOpenMenu={() => setSheetOpen(true)}
            menuOpen={sheetOpen}
            onLogout={handleLogout}
          />
          <div className="mx-auto w-full max-w-[1376px] px-4 pt-5 pb-[calc(56px+env(safe-area-inset-bottom)+16px)] sm:px-8 sm:pt-7 sm:pb-12">
            {children}
          </div>
        </div>
      </main>

      {isPhone ? (
        <PhoneTabBar
          onOpenMore={() => setSheetOpen(true)}
          moreOpen={sheetOpen}
        />
      ) : null}

      <UpdateBanner />

      <NavSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        variant={isPhone ? "bottom" : "full"}
        onLogout={handleLogout}
      />
    </div>
  );
}
