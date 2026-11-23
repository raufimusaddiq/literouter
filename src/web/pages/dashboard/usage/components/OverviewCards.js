"use client";

import PropTypes from "prop-types";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

const compact = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const compactCost = (n) => {
  const v = n || 0;
  return Math.abs(v) < 1000 ? `$${v.toFixed(2)}` : `$${compact(v)}`;
};

export default function OverviewCards({ stats }) {
  const figures = [
    {
      label: "Total requests",
      value: fmt(stats.totalRequests),
      exact: fmt(stats.totalRequests),
      lead: true,
    },
    {
      label: "Input tokens",
      value: compact(stats.totalPromptTokens),
      exact: fmt(stats.totalPromptTokens),
    },
    {
      label: "Cached tokens",
      value: compact(stats.totalCachedTokens),
      exact: fmt(stats.totalCachedTokens),
    },
    {
      label: "Output tokens",
      value: compact(stats.totalCompletionTokens),
      exact: fmt(stats.totalCompletionTokens),
    },
    {
      label: "Estimated cost",
      value: `~${compactCost(stats.totalCost)}`,
      exact: `~${fmtCost(stats.totalCost)}`,
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label="Usage summary">
      <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3.5 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-7 sm:gap-y-2">
        {figures.map((item) => (
          <div
            key={item.label}
            className={`flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2 ${item.lead ? "col-span-2 sm:col-span-1" : ""}`}
          >
            <strong
              title={item.exact}
              className={`truncate font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums] ${
                item.lead
                  ? "text-[32px] leading-[36px] sm:text-[44px] sm:leading-[46px]"
                  : "text-[26px] leading-[30px] sm:text-[34px] sm:leading-[38px]"
              }`}
            >
              {item.value}
            </strong>
            <span className="text-sm text-muted">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-faint">
        Across the selected period · estimated cost is not actual billing
      </p>
    </section>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
