import { cn } from "@/shared/utils/cn";

export function fieldClass({ invalid = false, panel = false, className } = {}) {
  return cn(
    "rounded-md border text-ink placeholder:text-faint focus:outline-none focus:ring-2",
    /(^|\s)(w-|flex-1)/.test(className || "") ? "" : "w-full",
    panel ? "bg-bg" : "bg-raise",
    invalid
      ? "border-danger focus:border-danger focus:ring-danger"
      : "border-line-strong focus:border-mark-line focus:ring-mark-line",
    className,
  );
}

export const linkButtonClass =
  "inline-flex min-h-9 items-center gap-1 self-start rounded-md px-2 text-xs font-semibold text-ink underline-offset-[3px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40";

export const iconButtonClass =
  "flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raise hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line disabled:cursor-not-allowed disabled:opacity-40";
