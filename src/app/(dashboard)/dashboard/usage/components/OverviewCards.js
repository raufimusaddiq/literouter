"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,1.05fr)_minmax(0,1.95fr)]">
      <Card className="flex min-h-[10rem] flex-col justify-between bg-primary/[0.08] px-5 py-4 ring-primary/20">
        <div className="flex items-start justify-between gap-4">
          <span className="text-xs font-semibold text-text-muted">Total requests</span>
          <span className="material-symbols-outlined text-primary" aria-hidden="true">north_east</span>
        </div>
        <div>
          <span className="metric-value block truncate text-4xl font-semibold text-text-main">{fmt(stats.totalRequests)}</span>
          <span className="mt-1 block text-xs text-text-muted">Across the selected period</span>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Input tokens" value={fmt(stats.totalPromptTokens)} />
        <Metric label="Cached tokens" value={fmt(stats.totalCachedTokens)} />
        <Metric label="Output tokens" value={fmt(stats.totalCompletionTokens)} />
        <Metric label="Estimated cost" value={`~${fmtCost(stats.totalCost)}`} detail="Not actual billing" />
      </div>
    </div>
  );
}

function Metric({ label, value, detail }) {
  return (
    <Card className="flex min-w-0 flex-col justify-between gap-3 px-4 py-3">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div>
        <span className="metric-value block truncate text-xl font-semibold text-text-main">{value}</span>
        {detail ? <span className="mt-1 block text-[10px] text-text-muted">{detail}</span> : null}
      </div>
    </Card>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
