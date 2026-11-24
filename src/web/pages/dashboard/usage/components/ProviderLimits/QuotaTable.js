"use client";

import Button from "@/shared/components/Button";
import { formatDate, formatTime } from "@/shared/utils/dateTime";
import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const dayKey = (d) => formatDate(d, undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
    const now = new Date();
    let dayStr = "";
    if (dayKey(date) === dayKey(now)) {
      dayStr = "Today";
    } else if (dayKey(date) === dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))) {
      dayStr = "Tomorrow";
    } else {
      dayStr = formatDate(date, undefined, { month: "short", day: "numeric" });
    }

    const timeStr = formatTime(date, undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return { text: "text-muted", bg: "bg-bar", dot: "bg-ok" };
  }

  if (remainingPercentage >= 30) {
    return { text: "text-warning", bg: "bg-warning", dot: "bg-warning" };
  }

  return { text: "text-danger", bg: "bg-danger", dot: "bg-danger" };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  useEffect(() => {
    (async () => {
      setPage(1);
    })();
  }, [sortMode, quotas]);

  useEffect(() => {
    (async () => {
      setPage((currentPage) => Math.min(currentPage, totalPages));
    })();
  }, [totalPages]);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const cellPad = compact ? "py-1 px-1.5" : "py-2 px-3";
  const nameText = compact ? "text-[11px]" : "text-sm";
  const resetPrimary = compact ? "text-[11px]" : "text-sm";
  const resetSecondary = compact ? "text-[11px] leading-tight" : "text-xs";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] tabular-nums text-muted">
          {sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-line px-2 py-1 text-[11px] text-muted">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="space-y-px">
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const isCreditBalance = quota.isCreditBalance === true;
          const colors = isCreditBalance
            ? { text: "text-muted", bg: "bg-bar", dot: "bg-faint" }
            : getColorClasses(quota.remaining);
          const countdown = formatResetTime(quota.resetAt);
          const resetDisplay = formatResetTimeDisplay(quota.resetAt);
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;

          return (
            <div
              key={`${quota.name}-${quota.index}`}
              className={`flex items-center gap-2 border-b border-line transition-colors last:border-b-0 hover:bg-bg/60 ${cellPad}`}
            >
              <div className="flex w-24 min-w-0 items-center gap-1.5 sm:w-36">
                <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${colors.dot}`} />
                <span className={`${nameText} font-medium text-ink truncate`}>
                  {quota.name}
                </span>
              </div>

              <div className={`min-w-0 flex-1 ${compact ? "space-y-1" : "space-y-1.5"}`}>
                {!isUnlimited && !isCreditBalance && (
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full transition-[width] duration-300 ${colors.bg}`}
                    style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                  />
                </div>
                )}

                <div className={`flex items-center justify-between gap-1 min-w-0 ${compact ? "text-[11px]" : "text-xs"}`}>
                  <span
                    className="truncate font-mono tabular-nums text-muted"
                    title={
                      isUnlimited
                        ? `${quota.used.toLocaleString()} used · Unlimited`
                        : isCreditBalance
                        ? `Credit balance: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                        : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`
                    }
                  >
                    {isUnlimited
                      ? `${quota.used.toLocaleString()} used · Unlimited`
                      : isCreditBalance
                      ? `Credit: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                      : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`}
                  </span>
                  <span className={`shrink-0 font-mono font-medium tabular-nums ${isUnlimited || isCreditBalance ? "text-muted" : colors.text}`}>
                    {isUnlimited ? "Unlimited" : isCreditBalance ? "" : `${quota.remaining}% left`}
                  </span>
                </div>
              </div>

              <div className="w-20 shrink-0 text-right sm:w-24">
                {countdown !== "-" || resetDisplay ? (
                  compact ? (
                    <div
                      className={`${resetPrimary} truncate font-mono font-medium tabular-nums text-ink`}
                      title={resetDisplay || ""}
                    >
                      {countdown !== "-" ? countdownLabel : resetDisplay}
                    </div>
                  ) : (
                    <div className="min-w-0 space-y-0.5">
                      {countdown !== "-" && (
                        <div className={`${resetPrimary} truncate font-mono font-medium tabular-nums text-ink`}>
                          {countdownLabel}
                        </div>
                      )}
                      {resetDisplay && (
                        <div className={`${resetSecondary} truncate font-mono tabular-nums text-muted`}>
                          {resetDisplay}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className={`${resetPrimary} text-faint italic`}>N/A</div>
                )}
              </div>

              {hasHideAction && (
                <button
                  type="button"
                  onClick={() => onHideQuota(quota)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-raise hover:text-ink"
                  title="Hide this quota row"
                  aria-label={`Hide quota ${quota.name}`}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
                    visibility_off
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-muted">
            <span>
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span>
              Page {page} / {totalPages}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
