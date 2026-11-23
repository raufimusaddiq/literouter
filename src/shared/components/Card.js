"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  variant = "section",
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev: _elev = false,
  className,
  ...props
}) {
  const isRaised = variant === "raised";
  const paddings = isRaised
    ? {
        none: "",
        xs: "p-3",
        sm: "p-4",
        md: "p-5",
        lg: "p-6",
      }
    : {
        none: "",
        xs: "pt-3",
        sm: "pt-4",
        md: "pt-5",
        lg: "pt-6",
      };

  return (
    <div
      className={cn(
        "relative",
        isRaised
          ? "rounded-lg border border-line-strong bg-raise"
          : "border-t border-line-strong",
        hover && (isRaised
          ? "cursor-pointer transition-colors duration-150 hover:border-ink/40"
          : "cursor-pointer transition-colors duration-150 hover:bg-raise/50"),
        paddings[padding] ?? paddings.md,
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-muted shrink-0">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
              )}
              {subtitle && (
                <p className="text-[12.5px] text-muted">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-raise p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "border-b border-line py-3 transition-colors last:border-b-0",
        "hover:bg-raise/60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0",
        "hover:bg-raise/60 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
};
