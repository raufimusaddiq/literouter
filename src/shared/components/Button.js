"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-ink text-bg border border-ink hover:opacity-90",
  secondary: "bg-transparent text-ink border border-line-strong hover:bg-raise",
  outline: "bg-transparent text-ink border border-line-strong hover:bg-raise",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-raise hover:text-ink",
  danger: "bg-transparent text-danger border border-danger hover:bg-danger/10",
  success: "bg-ink text-bg border border-ink hover:opacity-90",
};

const dangerFilled = "bg-danger text-white dark:text-bg border border-danger hover:opacity-90";

const sizes = {
  sm: "h-7 px-2.5 text-xs rounded-md",
  md: "h-8 px-3.5 text-[13px] rounded-md",
  lg: "h-9 px-4 text-sm rounded-md",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  filled = false,
  className,
  ...props
}) {
  const variantClass = variant === "danger" && filled ? dangerFilled : variants[variant] || variants.primary;
  const iconSize = size === "sm" ? "text-[16px]" : "text-[18px]";

  return (
    <button
      className={cn(
        "inline-flex touch-manipulation max-sm:min-h-11 items-center justify-center gap-1.5 font-semibold transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out cursor-pointer active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0",
        variantClass,
        sizes[size] || sizes.md,
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span aria-hidden="true" className={cn("material-symbols-outlined animate-spin", iconSize)}>progress_activity</span>
      ) : icon ? (
        <span aria-hidden="true" className={cn("material-symbols-outlined", iconSize)}>{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span aria-hidden="true" className={cn("material-symbols-outlined", iconSize)}>{iconRight}</span>
      )}
    </button>
  );
}
