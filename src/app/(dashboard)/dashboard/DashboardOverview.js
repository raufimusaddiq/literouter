"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, PageIntro, Skeleton } from "@/shared/components";

const actions = [
  { href: "/dashboard/endpoint", icon: "api", title: "Endpoint & keys", text: "Copy the stable client endpoint or rotate access." },
  { href: "/dashboard/providers", icon: "dns", title: "Provider network", text: "Connect providers and inspect route health." },
  { href: "/dashboard/usage", icon: "bar_chart", title: "Usage & analytics", text: "Trace requests, tokens, and fallback behavior." },
];

function getStatus(connection) {
  if (connection.isActive === false) return "paused";
  if (["active", "success"].includes(connection.testStatus)) return "ready";
  if (["error", "expired", "unavailable"].includes(connection.testStatus)) return "attention";
  return "unknown";
}

function Metric({ label, value, detail, tone = "neutral", href }) {
  const body = (
    <>
      <p className={`text-xs font-medium ${tone === "positive" ? "text-success" : tone === "warning" ? "text-warning" : "text-text-muted"}`}>{label}</p>
      <p className="metric-value mt-2 text-2xl font-semibold text-text-main">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </>
  );
  const className = "rounded-[14px] bg-surface p-4 ring-1 ring-border-subtle";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary`}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState({ connections: [], keys: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const stats = useMemo(() => {
    const statuses = data.connections.map(getStatus);
    return {
      total: data.connections.length,
      ready: statuses.filter((status) => status === "ready").length,
      attention: statuses.filter((status) => status === "attention").length,
      activeKeys: data.keys.filter((key) => key.isActive !== false).length,
    };
  }, [data]);

  const endpoint = typeof window === "undefined" ? "/v1" : `${window.location.origin}/v1`;
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

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageIntro
        title="Overview"
        description={`${stats.total} ${stats.total === 1 ? "connection" : "connections"} · ${stats.ready} ready · ${stats.attention} ${stats.attention === 1 ? "needs" : "need"} attention`}
        action={<Button variant="secondary" icon="refresh" onClick={load} loading={loading}>Refresh</Button>}
      />

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      <Card padding="none" className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm text-text-muted"><span className="size-2 rounded-full bg-success" />Endpoint</div>
        <code className="min-w-0 flex-1 truncate rounded-lg bg-bg-alt px-3 py-1.5 font-mono text-xs text-text-main ring-1 ring-border-subtle">{endpoint}</code>
        <div className="flex items-center gap-3">
          <Badge variant={protectedEndpoint ? "success" : "warning"} size="sm" dot>{protectedEndpoint ? "Protected" : "Review security"}</Badge>
          <Button size="sm" variant="outline" icon={copied ? "check" : "content_copy"} onClick={copyEndpoint}>{copied ? "Copied" : "Copy"}</Button>
          <Link href="/dashboard/endpoint" className="shrink-0 text-xs font-medium text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text-main">Manage</Link>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          [1, 2, 3, 4].map((item) => <Skeleton key={item} className="min-h-24 rounded-[14px]" />)
        ) : (
          <>
            <Metric label="Connections" value={stats.total} detail="Configured routes" />
            <Metric label="Ready now" value={stats.ready} detail="Passing connections" tone="positive" />
            <Metric label="Needs attention" value={stats.attention} detail="Needs investigation" tone="warning" href={stats.attention > 0 ? "/dashboard/providers#needs-attention" : undefined} />
            <Metric label="Active keys" value={stats.activeKeys} detail="Client access keys" />
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <div><p className="text-sm font-semibold text-text-main">Operational pulse</p><p className="mt-1 text-xs text-text-muted">The three surfaces operators touch most.</p></div>
            <Link href="/dashboard/providers" className="text-xs font-semibold text-primary hover:underline">Open network</Link>
          </div>
          <div className="divide-y divide-border-subtle">
            {actions.map((action) => (
              <Link key={action.href} href={action.href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"><span aria-hidden="true" className="material-symbols-outlined text-[20px]">{action.icon}</span></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-main">{action.title}</span><span className="mt-1 block truncate text-xs text-text-muted">{action.text}</span></span>
                <span aria-hidden="true" className="material-symbols-outlined text-text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary">arrow_forward</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="bg-primary/[0.06] ring-primary/15" padding="lg">
          <p className="text-xs font-medium text-text-muted">Next step</p>
          <h3 className="mt-2 text-lg font-semibold text-text-main">Connect a provider</h3>
          <p className="mt-3 text-sm leading-6 text-text-muted">Add a provider, test it, then route client traffic through the endpoint.</p>
          <Link href="/dashboard/providers/new" className="mt-6 inline-flex"><Button icon="add">Connect provider</Button></Link>
        </Card>
      </section>
    </div>
  );
}
