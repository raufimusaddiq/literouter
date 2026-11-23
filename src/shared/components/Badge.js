"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "text-muted",
  neutral: "text-muted",
  primary: "text-ink",
  success: "text-ok",
  warning: "text-warning",
  error: "text-danger",
  info: "text-muted",
};

const dotColors = {
  default: "bg-faint",
  neutral: "bg-faint",
  primary: "bg-ink",
  success: "bg-ok",
  warning: "bg-warning",
  error: "bg-danger",
  info: "bg-muted",
};

const sizes = {
  sm: "text-[11px] leading-4",
  md: "text-xs leading-4",
  lg: "text-[13px] leading-5",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = true,
  pill = false,
  icon,
  className,
}) {
  const showDot = dot && !icon && !pill;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold",
        pill && "rounded bg-surface-2 px-1.5 py-0.5 border border-line",
        variants[variant] || variants.default,
        sizes[size] || sizes.md,
        className
      )}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            dotColors[variant] || dotColors.default
          )}
        />
      )}
      {icon && <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{icon}</span>}
      {children}
    </span>
  );
}
