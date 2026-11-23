"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "@/web/router";
import { Button, SegmentedControl, Skeleton } from "@/shared/components";
import { classifyConnection, getConnectionHealthStats, HEALTH } from "@/shared/utils/connectionHealth";
import { useOrigin } from "@/shared/hooks/useOrigin";
import { niceTicks } from "./overview/niceTicks";
import RoutesBand from "./overview/RoutesBand";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
];
const LIST_ROWS = 6;

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return fmtInt(v);
};
const fmtCost = (n) => {
  const v = Number(n) || 0;
  return `~$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
};
const fmtUpdatedTime = (date) => {
  if (!date) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

function RequestsChart({ buckets }) {
  const max = Math.max(0, ...buckets.map((b) => b.requests || 0));
  const ticksAsc = niceTicks(max, 4);
  const topTick = ticksAsc[ticksAsc.length - 1] || 1;
  const ticks = [...ticksAsc].reverse();
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  const lastBucket = buckets[buckets.length - 1];
  const currentValue = lastBucket?.requests || 0;

  return (
    <div
      className="flex gap-2.5 pt-6"
      role="img"
      aria-label={`Requests over time, peak ${fmtInt(max)} per bucket, current ${fmtInt(currentValue)}`}
    >
      <div
        className="flex h-[154px] w-10 shrink-0 flex-col justify-between text-right font-mono text-[11px] leading-none text-faint sm:h-[168px]"
        aria-hidden="true"
      >
        {ticks.map((t, i) => <span key={i}>{fmtCompact(t)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-[154px] sm:h-[168px]">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {ticks.map((_, i) => (
              <div
                key={i}
                className={i === ticks.length - 1 ? "border-t border-line-strong" : "border-t border-dashed border-grid"}
              />
            ))}
          </div>
          <div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1.5">
            {buckets.map((b, i) => {
              const isCurrent = i === buckets.length - 1;
              const reqCount = b.requests || 0;
              const pct = (reqCount / topTick) * 100;
              return (
                <div
                  key={i}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
                  title={`${b.label}: ${fmtInt(reqCount)} requests`}
                >
                  <div
                    className={`relative w-full max-w-[34px] rounded-t-[1.5px] transition-opacity group-hover:opacity-85 ${
                      isCurrent ? "bg-mark" : "bg-bar"
                    }`}
                    style={{ height: `${pct}%`, minHeight: reqCount > 0 ? 2 : 1 }}
                  >
                    {isCurrent ? (
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded-[3px] bg-mark px-1.5 py-[3px] font-mono text-[11px] leading-none font-medium text-mark-ink">
                        now {fmtCompact(reqCount)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex gap-[3px] font-mono text-[11px] text-faint sm:gap-1.5" aria-hidden="true">
          {buckets.map((b, i) => {
            const showTick = i % labelEvery === 0;
            const tickIndex = Math.floor(i / labelEvery);
            return (
              <span
                key={i}
                className="relative min-w-0 flex-1 overflow-visible whitespace-nowrap"
              >
                {showTick ? (
                  <span className={tickIndex % 2 === 1 ? "hidden sm:inline" : "inline"}>{b.label}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const trafficHeadingId = useId();
  const [data, setData] = useState({ connections: [], keys: [], settings: {}, nodes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [period, setPeriod] = useState("24h");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [traffic, setTraffic] = useState({ buckets: [], stats: null, loading: true, error: false });

  const load = useCallback(async () => {
    setError("");
    try {
      const responses = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/keys"),
        fetch("/api/settings"),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("Workspace data unavailable");
      const [providers, keys, settings] = await Promise.all(responses.map((response) => response.json()));
      const nodes = await fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : {})).then((d) => d.nodes || []).catch(() => []);
      setData({ connections: providers.connections || [], keys: keys.keys || [], settings, nodes });
      setLastUpdated(new Date());
    } catch {
      setError("Workspace data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTraffic = useCallback(async (p) => {
    try {
      const [chartRes, statsRes] = await Promise.all([
        fetch(`/api/usage/chart?period=${p}`),
        fetch(`/api/usage/stats?period=${p}`),
      ]);
      if (!chartRes.ok || !statsRes.ok) throw new Error("usage unavailable");
      const [buckets, stats] = await Promise.all([chartRes.json(), statsRes.json()]);
      setTraffic({ buckets: Array.isArray(buckets) ? buckets : [], stats, loading: false, error: false });
      setLastUpdated(new Date());
    } catch {
      setTraffic((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => loadTraffic(period), 0);
    return () => window.clearTimeout(id);
  }, [period, loadTraffic]);

  const refresh = () => {
    load();
    loadTraffic(period);
  };

  const health = useMemo(() => getConnectionHealthStats(data.connections), [data.connections]);
  const activeKeys = useMemo(() => data.keys.filter((key) => key.isActive !== false).length, [data.keys]);

  const healthRows = useMemo(() => {
    const order = { [HEALTH.ATTENTION]: 0, [HEALTH.READY]: 1, [HEALTH.UNTESTED]: 2 };
    return data.connections
      .map((connection) => ({ connection, ...classifyConnection(connection) }))
      .filter((row) => row.status in order)
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, LIST_ROWS);
  }, [data.connections]);

  const origin = useOrigin();
  const endpoint = `${origin}/v1`;
  const protectedEndpoint = data.settings.requireApiKey === true && data.settings.requireLogin !== false && data.settings.hasPassword === true;

  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const hasConnections = health.total > 0;
  const stats = traffic.stats;
  const recent = useMemo(() => (stats?.recentRequests || []).slice(0, LIST_ROWS), [stats?.recentRequests]);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label || "24h";
  const updatedText = fmtUpdatedTime(lastUpdated);

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex flex-wrap items-center gap-3 sm:gap-5">
        <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px] sm:leading-[36px]">
          Overview
        </h1>
        <div className="inline-flex h-8 max-sm:h-[46px] w-full min-w-0 items-center overflow-hidden rounded-md border border-line-strong sm:w-auto sm:max-w-full">
          <code className="min-w-0 flex-1 truncate px-2.5 font-mono text-[11.5px] tracking-[-0.01em] text-ink sm:flex-initial sm:px-3 sm:text-[12.5px]">
            {endpoint}
          </code>
          <span
            className={`inline-flex h-full shrink-0 items-center gap-1.5 border-l border-line px-3 text-[12.5px] font-semibold ${
              protectedEndpoint ? "text-ok" : "text-warning"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-[7px] shrink-0 rounded-full ${protectedEndpoint ? "bg-ok" : "bg-warning"}`}
            />
            {protectedEndpoint ? "Protected" : "Open"}
          </span>
          <button
            type="button"
            onClick={copyEndpoint}
            className="h-full shrink-0 cursor-pointer border-l border-line bg-raise px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-line"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex w-full items-center justify-between gap-3 text-[12.5px] text-faint sm:ml-auto sm:w-auto sm:justify-end">
          {updatedText ? <span className="tabular-nums">Updated {updatedText}</span> : null}
          <Button variant="secondary" onClick={refresh} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-center justify-between gap-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}

      <section className="border-t border-line pt-5" aria-labelledby={trafficHeadingId}>
        <h2 id={trafficHeadingId} className="sr-only">
          Traffic, {periodLabel}
        </h2>

        {!loading && !hasConnections ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-muted">No traffic yet. Connect a provider to start routing.</p>
            <Link href="/dashboard/providers/new">
              <Button icon="add">Connect provider</Button>
            </Link>
          </div>
        ) : (
          <div>
            <div className="flex flex-col items-stretch justify-between gap-4 min-[860px]:flex-row min-[860px]:items-end min-[860px]:gap-6">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-7 sm:gap-y-1.5">
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <strong className="text-[28px] leading-[32px] font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums] sm:text-[44px] sm:leading-[46px]">
                    {stats ? fmtInt(stats.totalRequests) : "–"}
                  </strong>
                  <span className="text-sm text-muted">requests</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <strong className="text-[28px] leading-[32px] font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums] sm:text-[34px] sm:leading-[38px]">
                    {stats ? fmtCompact(stats.totalPromptTokens) : "–"}
                  </strong>
                  <span className="text-sm text-muted">tokens in</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <strong className="text-[28px] leading-[32px] font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums] sm:text-[34px] sm:leading-[38px]">
                    {stats ? fmtCompact(stats.totalCompletionTokens) : "–"}
                  </strong>
                  <span className="text-sm text-muted">out</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <strong className="text-[28px] leading-[32px] font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums] sm:text-[34px] sm:leading-[38px]">
                    {stats ? fmtCost(stats.totalCost) : "–"}
                  </strong>
                  <span className="text-sm text-muted">estimated cost</span>
                </div>
              </div>
              <SegmentedControl
                options={PERIODS}
                value={period}
                onChange={setPeriod}
                size="sm"
                className="self-start min-[860px]:self-auto"
              />
            </div>

            <div className="mt-2">
              {traffic.loading ? (
                <Skeleton className="mt-4 h-[190px] w-full rounded-md" />
              ) : traffic.error ? (
                <p className="py-16 text-center text-sm text-muted">Usage data could not be loaded.</p>
              ) : traffic.buckets.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted">No traffic in this period.</p>
              ) : (
                <RequestsChart buckets={traffic.buckets} />
              )}
            </div>

            <div className="mt-3 flex flex-col justify-between gap-1 text-[12.5px] text-faint sm:flex-row sm:items-center sm:gap-4">
              <span className="inline-flex min-w-0 items-center gap-2 text-muted">
                <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-ok" />
                <span className="min-w-0 truncate">
                  Route plane online · everything routes through <span className="font-mono text-ink">{endpoint}</span>
                </span>
              </span>
              <span className="shrink-0">
                {period === "7d" ? "Requests per day" : "Requests per hour"} · cost is an estimate, not billing
              </span>
            </div>
          </div>
        )}
      </section>

      <RoutesBand
        recent={recent}
        healthRows={healthRows}
        health={health}
        activeKeys={activeKeys}
        nodes={data.nodes}
        loading={loading}
        trafficLoading={traffic.loading}
        listRows={LIST_ROWS}
      />
    </div>
  );
}
