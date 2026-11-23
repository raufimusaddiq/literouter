"use client";

import { useState, useSyncExternalStore } from "react";
import { getUpdateAvailable, subscribeUpdate } from "@/web/buildWatch";

const hitArea = "relative max-sm:after:absolute max-sm:after:-inset-y-2";

export default function UpdateBanner() {
  const available = useSyncExternalStore(subscribeUpdate, getUpdateAvailable, () => false);
  const [dismissed, setDismissed] = useState(false);
  const visible = available && !dismissed;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-[calc(48px+env(safe-area-inset-top)+8px)] z-[55] flex justify-center sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:justify-end"
    >
      {visible ? (
        <div className="pointer-events-auto inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-line bg-raise pl-3.5 pr-1.5 text-ink">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-mark" />
          <p className="min-w-0 truncate text-[12.5px] font-medium">New version available</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${hitArea} max-sm:after:inset-x-0 inline-flex h-7 shrink-0 cursor-pointer items-center rounded px-1 text-[12.5px] font-semibold text-ink underline underline-offset-[3px] transition-opacity hover:opacity-70`}
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className={`${hitArea} max-sm:after:-inset-x-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-bg hover:text-ink`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
