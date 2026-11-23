"use client";

import { useMemo } from "react";
import { Link, usePathname } from "@/web/router";
import { getPageInfo } from "@/shared/components/Header";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

export default function PageHeader({
  title,
  meta,
  description,
  actions,
  showTitle = true,
  className = "",
}) {
  const pathname = usePathname();
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const breadcrumbs = pageInfo.breadcrumbs || [];
  const resolvedTitle = title ?? pageInfo.title;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] text-muted">
          {breadcrumbs.map((crumb, index) => (
            <div
              key={`${crumb.label}-${crumb.href || "current"}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 ? (
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-faint">
                  chevron_right
                </span>
              ) : null}
              {crumb.href ? (
                <Link href={crumb.href} className="text-muted transition-colors hover:text-ink">
                  {translate(crumb.label)}
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  {crumb.image ? (
                    <ProviderIcon
                      src={crumb.image}
                      alt={crumb.label}
                      size={18}
                      className="max-h-[18px] max-w-[18px] rounded object-contain"
                      fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                    />
                  ) : null}
                  <p className="truncate font-medium text-ink">
                    {translate(crumb.label)}
                  </p>
                </div>
              )}
            </div>
          ))}
        </nav>
      ) : null}

      {showTitle && resolvedTitle ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px] sm:leading-[36px]">
              {typeof resolvedTitle === "string" ? translate(resolvedTitle) : resolvedTitle}
            </h1>
            {meta}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}

      {description ? <p className="text-sm text-muted">{description}</p> : null}
    </div>
  );
}
