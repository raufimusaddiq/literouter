"use client";

import { formatDate } from "@/shared/utils/dateTime";
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return formatDate(iso);
}

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) return <span className="ml-1 text-faint opacity-50">↕</span>;
  return <span className="ml-1 text-ink">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

function ValueCells({ item, viewMode, isSummary = false }) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </td>
        <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] font-medium tabular-nums text-ink">
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </td>
      <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-muted">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] font-medium tabular-nums text-ink">
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

ValueCells.propTypes = {
  item: PropTypes.object.isRequired,
  viewMode: PropTypes.string.isRequired,
  isSummary: PropTypes.bool,
};

export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output tokens" },
        { field: "totalTokens", label: "Total tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input cost" },
      { field: "cachedCost", label: "Cached cost" },
      { field: "completionTokens", label: "Output cost" },
      { field: "cost", label: "Total cost" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <Card padding="none" className="overflow-hidden">
      {title ? (
        <div className="border-b border-line px-3 py-3 sm:px-4">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line-strong text-xs font-medium text-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  className={`cursor-pointer whitespace-nowrap px-3 py-2.5 sm:px-4 font-medium transition-colors hover:text-ink ${col.align === "right" ? "text-right" : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  className="cursor-pointer whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-medium transition-colors hover:text-ink"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {groupedData.map((group) => (
              <Fragment key={group.groupKey}>
                <tr
                  className="group-summary cursor-pointer transition-colors hover:bg-raise/70"
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <td className="max-w-[260px] px-3 py-2.5 sm:px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`material-symbols-outlined shrink-0 text-[16px] text-faint transition-transform ${expanded.has(group.groupKey) ? "rotate-90" : ""}`}
                      >
                        chevron_right
                      </span>
                      {group.summary.pending > 0 ? (
                        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-mark" />
                      ) : null}
                      <span className="truncate font-mono text-[12.5px] font-medium text-ink" title={group.groupKey}>
                        {group.groupKey}
                      </span>
                    </div>
                  </td>
                  {renderSummaryCells(group)}
                  <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                </tr>
                {expanded.has(group.groupKey) && group.items.map((item) => (
                  <tr
                    key={`detail-${item.key}`}
                    className="group-detail bg-raise/40 transition-colors hover:bg-raise"
                  >
                    {renderDetailCells(item)}
                    <ValueCells item={item} viewMode={viewMode} />
                  </tr>
                ))}
              </Fragment>
            ))}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string.isRequired,
  columns: PropTypes.arrayOf(PropTypes.shape({
    field: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    align: PropTypes.string,
  })).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderDetailCells: PropTypes.func.isRequired,
  renderSummaryCells: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

export { fmt, fmtCost, fmtTime };
