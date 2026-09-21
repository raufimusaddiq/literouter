"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "relative rounded-[14px] bg-surface ring-1 ring-border-subtle",
        elev ? "shadow-[var(--shadow-elev)]" : "shadow-[var(--shadow-soft)]",
        hover && "cursor-pointer transition-[box-shadow,ring-color,transform] duration-200 hover:-translate-y-px hover:ring-brand-500/30",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-[10px] bg-bg text-text-muted">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && (
                <h3 className="font-semibold tracking-[-0.02em] text-text-main">{title}</h3>
              )}
              {subtitle && (
                <p className="text-sm text-text-muted">{subtitle}</p>
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
        "rounded-xl bg-surface-2 p-4 ring-1 ring-border-subtle",
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
        "-mx-3 border-b border-border-subtle px-3 py-3 transition-colors last:border-b-0",
        "hover:bg-surface-2/70",
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
        "group -mx-3 flex items-center justify-between border-b border-border-subtle px-3 py-3 last:border-b-0",
        "hover:bg-surface-2/70 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
};
