"use client";

import { useMemo, useRef, useState } from "react";
import { Link } from "@/web/router";
import { Skeleton } from "@/shared/components";
import { HEALTH, HEALTH_LABELS } from "@/shared/utils/connectionHealth";
import { getAccountLabel, getProviderLabel } from "@/shared/utils/providerLabels";
import { computeRouteLinks } from "./routeLinks";
import RouteWires from "./RouteWires";

const isOkStatus = (status) => !status || ["ok", "success", "200"].includes(String(status).toLowerCase());

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return Math.round(v).toLocaleString("en-US");
};

function fmtShortAge(isoDate) {
  if (!isoDate) return "–";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (!Number.isFinite(diffSec)) return "–";
  if (diffSec < 5) return "now";
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SkeletonRows({ count = 5 }) {
  return (
    <ul className="m-0 list-none border-t border-line-strong p-0" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex h-[50px] items-center justify-between gap-4 border-b border-line">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-20" />
        </li>
      ))}
    </ul>
  );
}

export default function RoutesBand({
  recent = [],
  healthRows = [],
  health,
  activeKeys = 0,
  nodes = [],
  loading = false,
  trafficLoading = false,
  listRows = 6,
}) {
  const switchRef = useRef(null);
  const hubRef = useRef(null);
  const requestRefs = useRef([]);
  const providerRefs = useRef([]);
  const [hubTop, setHubTop] = useState(null);

  const visibleRecent = useMemo(() => recent.slice(0, listRows), [recent, listRows]);
  const visibleRows = useMemo(() => healthRows.slice(0, listRows), [healthRows, listRows]);

  const routeLinks = useMemo(
    () => computeRouteLinks(
      visibleRecent,
      visibleRows.map((row) => ({ provider: row.connection.provider })),
    ),
    [visibleRecent, visibleRows],
  );

  const hotProviders = useMemo(() => new Set(routeLinks.hits.keys()), [routeLinks.hits]);

  const firstRowIndexByProvider = useMemo(() => {
    const map = new Map();
    visibleRows.forEach((row, i) => {
      const pid = row.connection.provider;
      if (pid && !map.has(pid)) map.set(pid, i);
    });
    return map;
  }, [visibleRows]);

  const showRequestSkeleton = trafficLoading && visibleRecent.length === 0;
  const showProviderSkeleton = loading && visibleRows.length === 0;

  return (
    <section className="border-t border-line pt-5" aria-label="Routes">
      <div className="relative grid grid-cols-1 gap-y-7 min-[860px]:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] min-[860px]:gap-y-0">
        <div className="min-w-0">
          <div data-col-head="" className="flex h-[46px] items-baseline justify-between gap-3 max-sm:items-center">
            <div className="flex min-w-0 items-baseline gap-3 max-sm:items-center">
              <h2 className="shrink-0 text-base font-semibold tracking-[-0.01em] text-ink">Recent requests</h2>
              <Link
                href="/dashboard/endpoint"
                className="inline-flex items-center truncate text-[12.5px] text-muted transition-colors hover:text-ink max-sm:min-h-11"
              >
                from {activeKeys} active {activeKeys === 1 ? "key" : "keys"}
              </Link>
            </div>
            <Link
              href="/dashboard/usage"
              className="inline-flex shrink-0 items-center text-[12.5px] font-semibold text-ink underline underline-offset-[3px] transition-opacity hover:opacity-80 max-sm:min-h-11"
            >
              View all
            </Link>
          </div>

          {showRequestSkeleton ? (
            <SkeletonRows count={5} />
          ) : visibleRecent.length === 0 ? (
            <div className="flex h-[150px] items-center justify-center border-y border-line border-t-line-strong text-sm text-muted">
              No requests yet.
            </div>
          ) : (
            <ul data-route-requests="" className="m-0 list-none border-t border-line-strong p-0">
              {visibleRecent.map((r, i) => {
                const ok = isOkStatus(r.status);
                const isNewest = i === routeLinks.newest;
                const providerLabel = getProviderLabel(r.provider, nodes);
                return (
                  <li
                    key={`${r.timestamp || "req"}-${i}`}
                    ref={(el) => {
                      requestRefs.current[i] = el;
                    }}
                    className="grid h-[50px] grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line pr-0 min-[860px]:pr-3.5 sm:grid-cols-[74px_minmax(0,1fr)_auto]"
                  >
                    <span
                      className={`inline-flex items-center whitespace-nowrap font-mono text-[12.5px] tracking-[-0.01em] ${
                        isNewest ? "text-ink" : "text-faint"
                      }`}
                    >
                      {!ok ? (
                        <span
                          role="img"
                          aria-label={`Failed: ${r.status}`}
                          title={`Failed: ${r.status}`}
                          className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full bg-danger"
                        />
                      ) : isNewest ? (
                        <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full bg-mark" />
                      ) : null}
                      {fmtShortAge(r.timestamp)}
                    </span>
                    <span className="flex min-w-0 flex-col leading-4">
                      <span
                        className="truncate font-mono text-[12.5px] tracking-[-0.01em] text-ink"
                        title={r.model}
                      >
                        {r.model}
                      </span>
                      <span className="truncate text-xs text-muted" title={providerLabel}>
                        {providerLabel}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-right font-mono text-[12.5px] tracking-[-0.01em] text-ink">
                      {fmtCompact(r.promptTokens)}
                      <span aria-hidden="true" className="px-1 text-faint">→</span>
                      {fmtCompact(r.completionTokens)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div ref={switchRef} aria-hidden="true" className="relative hidden min-[860px]:block">
          <div className="h-[46px]" />
          {!showRequestSkeleton && !showProviderSkeleton ? (
            <RouteWires
              containerRef={switchRef}
              hubRef={hubRef}
              onHubTop={setHubTop}
              requestRefs={requestRefs}
              providerRefs={providerRefs}
              links={routeLinks.links}
              hot={hotProviders}
              newest={routeLinks.newest}
              requestCount={visibleRecent.length}
              providerCount={visibleRows.length}
            />
          ) : null}
          <div
            ref={hubRef}
            data-route-hub=""
            style={hubTop != null ? { top: `${hubTop}px` } : undefined}
            className="absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line-strong bg-bg px-2.5 py-1.5 font-mono text-xs text-ink"
          >
            <span className="block text-center">/v1</span>
            <span className="block text-center text-[10.5px] text-faint">route plane</span>
          </div>
        </div>

        <div className="min-w-0">
          <div data-col-head="" className="flex h-[46px] items-baseline justify-between gap-2 max-sm:items-center">
            <div className="flex min-w-0 items-baseline gap-2.5 max-sm:items-center">
              <h2 className="shrink-0 text-base font-semibold tracking-[-0.01em] text-ink">Providers</h2>
              <span className="min-w-0 truncate text-[12.5px] text-muted">
                {health.total} {health.total === 1 ? "connection" : "connections"} · {health.ready} ready ·{" "}
                <Link
                  href="/dashboard/providers#needs-attention"
                  className={
                    health.attention > 0
                      ? "font-medium text-warning underline underline-offset-[3px] hover:opacity-80"
                      : "transition-colors hover:text-ink"
                  }
                >
                  {health.attention} need attention
                </Link>
              </span>
            </div>
            <Link
              href="/dashboard/providers"
              className="inline-flex shrink-0 items-center text-[12.5px] font-semibold text-ink underline underline-offset-[3px] transition-opacity hover:opacity-80 max-sm:min-h-11"
            >
              View all
            </Link>
          </div>

          {showProviderSkeleton ? (
            <SkeletonRows count={5} />
          ) : visibleRows.length === 0 ? (
            <div className="flex h-[150px] items-center justify-center border-y border-line border-t-line-strong text-sm text-muted">
              No active connections.
            </div>
          ) : (
            <ul data-route-providers="" className="m-0 list-none border-t border-line-strong p-0">
              {visibleRows.map(({ connection, status, reason }, i) => {
                const providerLabel = getProviderLabel(connection.provider, nodes);
                const accountLabel = getAccountLabel(connection, providerLabel);
                const isFirstForProvider = firstRowIndexByProvider.get(connection.provider) === i;
                const hitCount = isFirstForProvider ? routeLinks.hits.get(connection.provider) || 0 : 0;
                const isFailing = status === HEALTH.ATTENTION && (reason === "error" || reason === "expired");
                const isAttention = status === HEALTH.ATTENTION;
                const dotTone = status === HEALTH.READY
                  ? "bg-ok"
                  : isFailing
                    ? "bg-danger"
                    : isAttention
                      ? "bg-warning"
                      : "bg-faint";
                const textTone = status === HEALTH.READY
                  ? "text-ok"
                  : isFailing
                    ? "text-danger"
                    : isAttention
                      ? "text-warning"
                      : "text-muted";
                const statusLabel = isAttention ? reason.replace("_", " ") : HEALTH_LABELS[status];

                return (
                  <li
                    key={connection.id}
                    data-provider={connection.provider}
                    ref={(el) => {
                      providerRefs.current[i] = el;
                    }}
                    className="border-b border-line"
                  >
                    <Link
                      href={`/dashboard/providers/${connection.provider}`}
                      className="grid h-[50px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 pl-0 transition-colors hover:bg-raise focus-visible:bg-raise min-[860px]:pl-3.5 sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_auto]"
                    >
                      <span className="flex min-w-0 items-baseline gap-2.5">
                        <span className="truncate font-semibold text-ink" title={providerLabel}>
                          {providerLabel}
                        </span>
                        {hitCount > 0 && visibleRecent.length > 0 ? (
                          <span className="shrink-0 font-mono text-[11.5px] font-normal text-faint">
                            {hitCount} of last {visibleRecent.length}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="hidden min-w-0 truncate font-mono text-[12.5px] tracking-[-0.01em] text-muted sm:block"
                        title={accountLabel}
                      >
                        {accountLabel}
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-[7px] text-[12.5px] font-semibold ${textTone}`}>
                        <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${dotTone}`} />
                        {statusLabel}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-2.5 text-xs text-faint">
            {health.inactive} inactive · {health.untested} untested
          </p>
        </div>
      </div>
    </section>
  );
}
