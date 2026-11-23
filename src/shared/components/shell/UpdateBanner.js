"use client";

import { useState, useSyncExternalStore } from "react";
import Button from "@/shared/components/Button";
import { getUpdateAvailable, subscribeUpdate } from "@/web/buildWatch";

export default function UpdateBanner() {
  const available = useSyncExternalStore(subscribeUpdate, getUpdateAvailable, () => false);
  const [dismissed, setDismissed] = useState(false);
  const visible = available && !dismissed;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] z-[55] sm:inset-x-auto sm:bottom-4 sm:right-4"
    >
      {visible ? (
        <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-line-strong bg-raise py-2 pl-3 pr-2 text-ink">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-mark" />
          <p className="min-w-0 flex-1 text-[13px] font-medium">New version available</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => setDismissed(true)}>Later</Button>
        </div>
      ) : null}
    </div>
  );
}
