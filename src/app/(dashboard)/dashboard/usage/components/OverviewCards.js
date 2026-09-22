"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

/** Keep card labels short; the exact value stays available via `title`. */
const compact = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const compactCost = (n) => {
  const v = n || 0;
  return Math.abs(v) < 1000 ? `$${v.toFixed(2)}` : `$${compact(v)}`;
};

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-stretch">
      <Card className="flex h-full flex-col gap-2 bg-primary/[0.08] px-5 py-4 ring-primary/20">
        <span className="text-xs font-semibold text-text-muted">Total requests</span>
        <span className="metric-value block truncate text-3xl font-semibold text-text-main" title={fmt(stats.totalRequests)}>{fmt(stats.totalRequests)}</span>
        <span className="text-xs text-text-muted">Across the selected period</span>
      </Card>
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Input tokens" value={compact(stats.totalPromptTokens)} exact={fmt(stats.totalPromptTokens)} />
        <Metric label="Cached tokens" value={compact(stats.totalCachedTokens)} exact={fmt(stats.totalCachedTokens)} />
        <Metric label="Output tokens" value={compact(stats.totalCompletionTokens)} exact={fmt(stats.totalCompletionTokens)} />
        <Metric label="Estimated cost" value={`~${compactCost(stats.totalCost)}`} exact={`~${fmtCost(stats.totalCost)}`} detail="Not actual billing" />
      </div>
    </div>
  );
}

function Metric({ label, value, exact, detail }) {
  return (
    <Card className="flex h-full min-w-0 flex-col justify-between gap-3 px-4 py-3">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div>
        <span className="metric-value block truncate text-xl font-semibold text-text-main" title={exact}>
          {value}
        </span>
        {detail ? <span className="mt-1 block text-[10px] text-text-muted">{detail}</span> : null}
      </div>
    </Card>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
