"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, PageIntro, Skeleton } from "@/shared/components";
import { classifyConnection, getConnectionHealthStats, HEALTH, HEALTH_LABELS } from "@/shared/utils/connectionHealth";
import { getRelativeTime } from "@/shared/utils";
import { useOrigin } from "@/shared/hooks/useOrigin";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
];
const LIST_ROWS = 6;
const ROW_HEIGHT = "h-[3.25rem]";

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
const isOkStatus = (status) => !status || ["ok", "success", "200"].includes(String(status).toLowerCase());

function Metric({ label, value, detail, tone = "neutral", href }) {
  const labelTone = tone === "positive" ? "text-success" : tone === "warning" ? "text-warning" : "text-text-muted";
  const body = (
    <>
      <p className={`text-xs font-medium ${labelTone}`}>{label}</p>
      <p className="metric-value mt-2 text-2xl font-semibold text-text-main">{value}</p>
      <p className="mt-1 truncate text-xs text-text-muted">{detail}</p>
    </>
  );
  const className = "block min-w-0 rounded-[14px] bg-surface p-4 ring-1 ring-border-subtle";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary`}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function PeriodSwitch({ value, onChange }) {
  return (
    <div role="group" aria-label="Time range" className="inline-flex rounded-lg bg-bg-alt p-0.5 ring-1 ring-border-subtle">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          aria-pressed={value === p.value}
          onClick={() => onChange(p.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
            value === p.value ? "bg-surface text-text-main shadow-sm ring-1 ring-border-subtle" : "text-text-muted hover:text-text-main"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function RequestsChart({ buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.requests || 0));
  const niceMax = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    const n = max / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  })();
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(niceMax * f));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  return (
    <div className="flex gap-3" role="img" aria-label={`Requests over time, peak ${fmtInt(max)} per bucket`}>
      <div className="flex h-[168px] w-10 shrink-0 flex-col justify-between text-right text-[11px] leading-none text-text-muted metric-value" aria-hidden="true">
        {ticks.map((t, i) => <span key={i}>{fmtCompact(t)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-[168px]">
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {ticks.map((_, i) => <div key={i} className="border-t border-border-subtle/60" />)}
          </div>
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {buckets.map((b, i) => (
              <div key={i} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${b.label}: ${fmtInt(b.requests)} requests`}>
                <div
                  className="w-full rounded-t-[2px] bg-primary transition-opacity group-hover:opacity-80"
                  style={{ height: `${((b.requests || 0) / niceMax) * 100}%`, minHeight: b.requests > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-[3px] text-[11px] text-text-muted" aria-hidden="true">
          {buckets.map((b, i) => (
            <span key={i} className="relative min-w-0 flex-1 overflow-visible whitespace-nowrap">
              {i % labelEvery === 0 ? b.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ ok, label }) {
  return <span role="img" aria-label={label} title={label} className={`inline-block size-2 shrink-0 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />;
}

function ListCard({ title, href, hrefLabel, children, empty }) {
  return (
    <Card padding="none" className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <h2 className="text-sm font-semibold text-text-main">{title}</h2>
        <Link href={href} className="text-xs font-medium text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text-main">{hrefLabel}</Link>
      </div>
      {empty ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-text-muted" style={{ minHeight: `calc(${LIST_ROWS} * 3.25rem)` }}>{empty}</div>
      ) : (
        <ul className="divide-y divide-border-subtle" style={{ minHeight: `calc(${LIST_ROWS} * 3.25rem)` }}>{children}</ul>
      )}
    </Card>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState({ connections: [], keys: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [period, setPeriod] = useState("24h");
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
      setData({ connections: providers.connections || [], keys: keys.keys || [], settings });
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
  const recent = (stats?.recentRequests || []).slice(0, LIST_ROWS);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageIntro
        title="Overview"
        meta={
          <span className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-surface py-1 pl-3 pr-1 text-sm ring-1 ring-border-subtle">
            <code className="min-w-0 truncate font-mono text-xs text-text-main">{endpoint}</code>
            <Badge variant={protectedEndpoint ? "success" : "warning"} size="sm" dot>{protectedEndpoint ? "Protected" : "Review security"}</Badge>
            <Button size="sm" variant="outline" icon={copied ? "check" : "content_copy"} onClick={copyEndpoint}>{copied ? "Copied" : "Copy"}</Button>
          </span>
        }
        action={<Button variant="secondary" icon="refresh" onClick={refresh} loading={loading}>Refresh</Button>}
      />

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </div>
      )}

      <Card padding="none" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-sm font-semibold text-text-main">Requests</h2>
          {(hasConnections || loading) && <PeriodSwitch value={period} onChange={setPeriod} />}
        </div>
        {!loading && !hasConnections ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <p className="text-sm text-text-muted">No traffic yet. Connect a provider to start routing.</p>
            <Link href="/dashboard/providers/new"><Button icon="add">Connect provider</Button></Link>
          </div>
        ) : (
          <div className="px-5 pb-4 pt-4">
            {traffic.loading ? (
              <Skeleton className="h-[200px] rounded-xl" />
            ) : traffic.error ? (
              <p className="py-16 text-center text-sm text-text-muted">Usage data could not be loaded.</p>
            ) : (
              <RequestsChart buckets={traffic.buckets} />
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border-subtle pt-4 sm:grid-cols-4">
              {[
                ["Requests", fmtInt(stats?.totalRequests)],
                ["Input tokens", fmtCompact(stats?.totalPromptTokens)],
                ["Output tokens", fmtCompact(stats?.totalCompletionTokens)],
                ["Estimated cost", fmtCost(stats?.totalCost)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-text-muted">{label} · {periodLabel}</dt>
                  <dd className="metric-value mt-0.5 text-lg font-semibold text-text-main">{stats ? value : "–"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex min-w-0 items-center gap-2 text-xs text-text-muted">
              <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
              <span className="min-w-0 truncate">Route plane online · Everything routes through {endpoint}</span>
            </p>
          </div>
        )}
      </Card>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          [1, 2, 3, 4].map((item) => <Skeleton key={item} className="min-h-24 rounded-[14px]" />)
        ) : (
          <>
            <Metric label="Connections" value={health.total} detail={`${health.inactive} inactive · ${health.untested} untested`} />
            <Metric label={HEALTH_LABELS.ready} value={health.ready} detail="Verified passing" tone={health.ready > 0 ? "positive" : "neutral"} />
            <Metric label={HEALTH_LABELS.attention} value={health.attention} detail="Errors, cooldown or rate limits" tone={health.attention > 0 ? "warning" : "neutral"} href="/dashboard/providers#needs-attention" />
            <Metric label="Active keys" value={activeKeys} detail="Client access keys" />
          </>
        )}
      </section>

      {(hasConnections || loading) && (
        <section className="grid items-stretch gap-4 lg:grid-cols-2">
          <ListCard title="Recent requests" href="/dashboard/usage" hrefLabel="View all" empty={!traffic.loading && recent.length === 0 ? "No requests yet." : null}>
            {recent.map((r, i) => {
              const ok = isOkStatus(r.status);
              return (
                <li key={`${r.timestamp}-${i}`} className={`flex ${ROW_HEIGHT} items-center gap-3 px-4`}>
                  <StatusDot ok={ok} label={ok ? "Succeeded" : `Failed: ${r.status}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-main">{r.model}</p>
                    <p className="truncate text-xs text-text-muted">{r.provider || "unknown"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="metric-value text-xs text-text-main">{fmtCompact(r.promptTokens)} in · {fmtCompact(r.completionTokens)} out</p>
                    <p className="text-xs text-text-muted">{r.timestamp ? getRelativeTime(r.timestamp) : "–"}</p>
                  </div>
                </li>
              );
            })}
          </ListCard>

          <ListCard title="Provider health" href="/dashboard/providers" hrefLabel="View all" empty={!loading && healthRows.length === 0 ? "No active connections." : null}>
            {healthRows.map(({ connection, status, reason }) => {
              const tone = status === HEALTH.ATTENTION ? "bg-warning" : status === HEALTH.READY ? "bg-success" : "bg-text-muted/50";
              const detail = status === HEALTH.ATTENTION ? reason.replace("_", " ") : HEALTH_LABELS[status].toLowerCase();
              return (
                <li key={connection.id}>
                  <Link href={`/dashboard/providers/${connection.provider}`} className={`flex ${ROW_HEIGHT} items-center gap-3 px-4 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2`}>
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-main">{connection.name || connection.email || connection.provider}</p>
                      <p className="truncate text-xs text-text-muted">{connection.provider}</p>
                    </div>
                    <span className={`shrink-0 text-xs ${status === HEALTH.ATTENTION ? "text-warning" : "text-text-muted"}`}>{detail}</span>
                  </Link>
                </li>
              );
            })}
          </ListCard>
        </section>
      )}
    </div>
  );
}
