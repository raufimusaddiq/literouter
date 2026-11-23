"use client";

import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
}) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages = [];
    const showMax = 5;

    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + showMax - 1);

    if (end - start + 1 < showMax) {
      start = Math.max(1, end - showMax + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-4 py-3 border-t border-line",
        className
      )}
    >
      {totalItems > 0 && (
        <div className="text-[12.5px] text-muted tabular-nums">
          Showing <span className="font-mono text-ink">{startItem}</span> to{" "}
          <span className="font-mono text-ink">{endItem}</span> of{" "}
          <span className="font-mono text-ink">{totalItems}</span> results
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={cn(
                "h-7 rounded-md border border-line-strong bg-raise px-2",
                "text-xs text-ink focus:outline-none focus:ring-2 focus:ring-mark-line",
                "cursor-pointer"
              )}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="px-2"
            >
              Prev
            </Button>

            {pageNumbers[0] > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(1)}
                  className="min-w-7 px-2 hidden sm:inline-flex font-mono"
                >
                  1
                </Button>
                {pageNumbers[0] > 2 && (
                  <span className="text-faint px-1 hidden sm:inline">…</span>
                )}
              </>
            )}

            {pageNumbers.map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "primary" : "ghost"}
                size="sm"
                onClick={() => onPageChange(page)}
                aria-current={currentPage === page ? "page" : undefined}
                className={cn(
                  "min-w-7 px-2 font-mono",
                  currentPage === page ? "inline-flex" : "hidden sm:inline-flex"
                )}
              >
                {page}
              </Button>
            ))}

            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                  <span className="text-faint px-1 hidden sm:inline">…</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(totalPages)}
                  className="min-w-7 px-2 hidden sm:inline-flex font-mono"
                >
                  {totalPages}
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="px-2"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
