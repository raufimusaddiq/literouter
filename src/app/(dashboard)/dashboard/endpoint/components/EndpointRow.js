"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row: label + copyable URL. Stacks on narrow screens. */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 text-center ${badge === "CF" || badge === "TS" ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"}`}>{label}</span>
      <Input value={url} readOnly className="min-w-0 flex-1 basis-full font-mono text-sm sm:basis-auto" />
      <button
        type="button"
        onClick={() => onCopy(url, copyId)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
        aria-label={`Copy ${label} endpoint`}
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}
