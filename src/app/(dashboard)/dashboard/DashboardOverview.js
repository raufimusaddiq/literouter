"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Skeleton } from "@/shared/components";

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

function Metric({ label, value, detail, tone = "neutral" }) {
  return (
    <div className="rounded-[14px] bg-surface p-4 ring-1 ring-border-subtle">
      <p className={`page-kicker ${tone === "positive" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}>{label}</p>
      <p className="metric-value mt-3 text-3xl font-semibold text-text-main">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </div>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState({ connections: [], keys: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">Operator overview</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.06em] text-text-main sm:text-4xl">Routing control center</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">A fast read on the endpoint, provider network, and the next operational move.</p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={load} loading={loading}>Refresh state</Button>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <article className="relative min-h-[18rem] overflow-hidden rounded-[14px] bg-surface p-6 text-text-main ring-1 ring-border-subtle shadow-[var(--shadow-elevated)] sm:p-8">
          <div className="relative z-10 flex h-full flex-col justify-between gap-10">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-muted"><span className="size-2 rounded-full bg-success" />Route plane online</div>
              <Badge variant={protectedEndpoint ? "success" : "warning"} size="sm" dot>{protectedEndpoint ? "Protected" : "Review security"}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Primary endpoint</p>
              <h3 className="mt-3 max-w-xl text-3xl font-semibold leading-[1.05] tracking-[-0.06em] sm:text-5xl">Everything routes through here.</h3>
              <p className="mt-4 max-w-lg text-sm leading-6 text-text-muted">One OpenAI-compatible surface for provider credentials, fallback, and request observability.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 truncate rounded-lg bg-bg-alt px-3 py-2 font-mono text-xs text-primary ring-1 ring-border-subtle">{endpoint}</code>
              <Link href="/dashboard/endpoint" className="shrink-0 text-xs font-semibold text-text-main underline decoration-border underline-offset-4 transition-colors hover:text-primary">Manage endpoint</Link>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full border border-primary/20" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-4 -top-4 size-40 rounded-full border border-primary/15" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-1/2 w-1/2 bg-primary/[0.06] [clip-path:polygon(35%_0,100%_0,100%_100%,0_100%)]" aria-hidden="true" />
        </article>

        <div className="grid grid-cols-2 gap-3">
          {loading ? (
            [1, 2, 3, 4].map((item) => <Skeleton key={item} className="min-h-32 rounded-[14px]" />)
          ) : (
            <>
              <Metric label="Connections" value={stats.total} detail="Configured routes" />
              <Metric label="Ready now" value={stats.ready} detail="Passing connections" tone="positive" />
              <Metric label="Attention" value={stats.attention} detail="Needs investigation" tone="warning" />
              <Metric label="Active keys" value={stats.activeKeys} detail="Client access keys" />
            </>
          )}
        </div>
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
          <p className="page-kicker">Next move</p>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-text-main">Keep the route boring.</h3>
          <p className="mt-3 text-sm leading-6 text-text-muted">Connect one provider, test it, then let the router absorb the operational noise.</p>
          <Link href="/dashboard/providers/new" className="mt-6 inline-flex"><Button icon="add">Connect provider</Button></Link>
        </Card>
      </section>
    </div>
  );
}
