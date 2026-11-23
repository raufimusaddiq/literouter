"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useScrollReset } from "@/web/router";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

const DESKTOP_QUERY = "(min-width: 1024px)";
const subscribeDesktop = (onChange) => {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getServerDesktop = () => false;

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const pathname = usePathname();
  const scrollRef = useRef(null);
  useScrollReset(scrollRef);
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="dashboard-backdrop h-[100dvh] w-full overflow-hidden [padding:env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-md border border-line-strong border-l-[3px] bg-raise text-ink px-3 py-2.5 shadow-[var(--shadow-float)] ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] leading-5 ${style.iconClass}`}>{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5 text-ink">{n.title}</p> : null}
                  <p className="text-xs text-muted whitespace-pre-wrap break-words">{n.message}</p>
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
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/35 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="mx-auto flex h-full w-full max-w-[1920px]">
        <div
          className={
            isDesktop
              ? "static h-full shrink-0"
              : `fixed inset-y-2 left-2 z-50 transform transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  sidebarOpen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]"
                }`
          }
          inert={!isDesktop && !sidebarOpen}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>

        <main id="main-content" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg transition-colors duration-300">
          <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-7 sm:px-7 lg:px-12 lg:py-10">
            <div className="mx-auto w-full max-w-[110rem]">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
