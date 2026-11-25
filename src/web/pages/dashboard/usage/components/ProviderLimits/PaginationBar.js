"use client";

import { Button, Input, Select } from "@/shared/components";
import { ACCOUNT_PAGE_SIZE_OPTIONS, ACCOUNT_PAGE_SIZE_MAX } from "./utils";

export default function PaginationBar({
  connectionsPageSummary,
  isCustomPageSize,
  pageSize,
  customPageSizeInput,
  setCustomPageSizeInput,
  commitPageSize,
  setPage,
  setPageSize,
  pagination,
  connectionsLoading,
  refreshingAll,
}) {
  return (
    <div className="border-t border-line-strong pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs tabular-nums text-muted">{connectionsPageSummary}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={isCustomPageSize ? "custom" : String(pageSize)}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === "custom") return;
              const nextPageSize = Number.parseInt(nextValue, 10);
              if (Number.isFinite(nextPageSize)) {
                setPage(1);
                setPageSize(nextPageSize);
                setCustomPageSizeInput(String(nextPageSize));
              }
            }}
            options={[
              ...ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: `${option} / page` })),
              { value: "custom", label: "Custom" },
            ]}
            aria-label="Accounts per page"
          />
          <Input
            type="number"
            min="1"
            max={String(ACCOUNT_PAGE_SIZE_MAX)}
            inputMode="numeric"
            value={customPageSizeInput}
            onChange={(event) => setCustomPageSizeInput(event.target.value)}
            onBlur={commitPageSize}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitPageSize();
            }}
            className="w-24"
            inputClassName="font-mono tabular-nums"
            aria-label="Custom accounts per page"
            placeholder="Custom"
          />
          {pagination.totalPages > 1 && (
            <span className="font-mono text-xs tabular-nums text-muted">Page {pagination.page} / {pagination.totalPages}</span>
          )}
        </div>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setPage(1)}
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
            >
              First Page
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon="chevron_left"
              onClick={() =>
                setPage((currentPage) => Math.max(1, currentPage - 1))
              }
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
              aria-label="Previous accounts page"
            />
            <Button
              variant="secondary"
              size="lg"
              icon="chevron_right"
              onClick={() =>
                setPage((currentPage) =>
                  Math.min(pagination.totalPages, currentPage + 1),
                )
              }
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
              aria-label="Next accounts page"
            />
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setPage(pagination.totalPages)}
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
            >
              Last Page
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
