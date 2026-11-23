"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  disabled = false,
  className,
}) {
  const sizes = {
    sm: "h-[26px] px-2.5 text-[12.5px]",
    md: "h-7 px-3 text-[13px]",
    lg: "h-8 px-3.5 text-sm",
  };

  return (
    <div
      role="group"
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex items-center p-0.5 rounded-md border border-line-strong bg-transparent overflow-x-auto",
        disabled && "opacity-50",
        className
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
            className={cn(
              "shrink-0 inline-flex items-center justify-center rounded-[4px] font-semibold transition-colors",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
              sizes[size] || sizes.md,
              active
                ? "bg-ink text-bg"
                : disabled
                  ? "text-muted"
                  : "text-muted hover:text-ink"
            )}
          >
            {option.icon && (
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] mr-1.5">
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
