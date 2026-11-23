"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();

  const variants = {
    default: cn(
      "flex items-center justify-center size-8 rounded-md border border-transparent",
      "text-muted hover:text-ink hover:border-line",
      "transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-9 rounded-md",
      "bg-raise hover:bg-surface-2",
      "border border-line-strong",
      "text-muted hover:text-ink",
      "transition-colors group"
    ),
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(variants[variant] || variants.default, className)}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[18px]"
      >
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
