"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { formatZoneLabel } from "@/shared/utils/dateTime";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { Skeleton } from "@/shared/components/Loading";
import { niceTicks } from "@/web/pages/dashboard/overview/niceTicks";

const VIEW_OPTIONS = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
];

const fmtTokens = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) {
    const s = (v / 1000000).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}M`;
  }
  if (v >= 1000) {
    const s = (v / 1000).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}K`;
  }
  return String(Math.round(v));
};

const fmtCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

const fmtCostAxis = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v >= 10) return `$${v.toFixed(0)}`;
  if (v >= 0.1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
};

function ChartTooltip({ active, payload, label, viewMode }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="rounded-md border border-line-strong bg-raise px-2.5 py-2 text-xs text-ink">
      <div className="font-mono text-[11px] text-faint">{label}</div>
      <div className="mt-0.5 font-mono font-medium text-ink tabular-nums">
        {viewMode === "tokens" ? `${fmtTokens(val)} tokens` : fmtCost(val)}
      </div>
    </div>
  );
}

ChartTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string,
  viewMode: PropTypes.string.isRequired,
};

export default function UsageChart({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(Array.isArray(json) ? json : []);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const id = window.setTimeout(fetchData, 0);
    return () => window.clearTimeout(id);
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);
  const dataKey = viewMode === "tokens" ? "tokens" : "cost";

  const currentIndex = useMemo(() => {
    if (!data.length) return -1;
    if (period === "today") return Math.min(new Date().getHours(), data.length - 1);
    return data.length - 1;
  }, [data.length, period]);

  const { yTicks, topTick } = useMemo(() => {
    const maxVal = Math.max(0, ...data.map((d) => Number(d[dataKey]) || 0));
    const ticks = viewMode === "tokens"
      ? niceTicks(maxVal, 4)
      : niceTicks(maxVal, 4, { integer: false });
    return { yTicks: ticks, topTick: ticks[ticks.length - 1] || 1 };
  }, [data, dataKey, viewMode]);

  const currentValue = currentIndex >= 0 ? Number(data[currentIndex]?.[dataKey]) || 0 : 0;

  return (
    <Card padding="md" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
            {viewMode === "tokens" ? "Tokens over time" : "Estimated cost over time"}
          </h2>
          {!loading && hasData && currentIndex >= 0 ? (
            <span className="rounded-[3px] bg-mark px-1.5 py-[3px] font-mono text-[11px] leading-none font-medium text-mark-ink tabular-nums">
              now {viewMode === "tokens" ? fmtTokens(currentValue) : fmtCostAxis(currentValue)}
            </span>
          ) : null}
        </div>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
        />
      </div>

      {loading ? (
        <Skeleton className="h-[220px] w-full rounded-md" />
      ) : !hasData ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted">
          No data for this period
        </div>
      ) : (
        <div className="h-[220px] w-full min-w-0">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 4" stroke="var(--color-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-faint)", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                ticks={yTicks}
                domain={[0, topTick]}
                tick={{ fontSize: 11, fill: "var(--color-faint)", fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCostAxis}
                width={54}
              />
              <Tooltip
                cursor={{ fill: "var(--color-line)", fillOpacity: 0.45 }}
                content={<ChartTooltip viewMode={viewMode} />}
              />
              <Bar
                dataKey={dataKey}
                maxBarSize={34}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              >
                {data.map((entry, idx) => (
                  <Cell
                    key={`${entry.label}-${idx}`}
                    fill={idx === currentIndex ? "var(--color-mark)" : "var(--color-bar)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {(period === "today" || period === "24h") && (
        <p className="text-right font-mono text-[11.5px] text-faint">Times in {formatZoneLabel()}</p>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
