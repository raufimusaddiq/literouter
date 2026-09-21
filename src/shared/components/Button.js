"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-brand-500 hover:bg-brand-600 text-white shadow-[0_10px_20px_-14px_var(--color-primary)] disabled:bg-surface-3 disabled:text-text-muted",
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main ring-1 ring-border disabled:opacity-50",
  outline: "ring-1 ring-border text-text-main hover:bg-surface-2 hover:ring-brand-500/40",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger: "bg-red-500 hover:bg-red-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  success: "bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  sm: "min-h-9 px-3 text-xs rounded-lg",
  md: "min-h-10 px-4 text-sm rounded-xl",
  lg: "h-11 px-5 text-sm rounded-xl",
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
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex touch-manipulation items-center justify-center gap-2 font-semibold transition-[background-color,color,box-shadow,transform] duration-200 ease-out cursor-pointer active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
