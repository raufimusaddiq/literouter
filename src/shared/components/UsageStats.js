"use client";

import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "@/web/router";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";
import Badge from "./Badge";
import Card from "./Card";
import SegmentedControl from "./SegmentedControl";
import { Skeleton } from "./Loading";
import OverviewCards from "@/web/pages/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/web/pages/dashboard/usage/components/UsageTable";

const ProviderTopology = lazy(() => import("@/web/pages/dashboard/usage/components/ProviderTopology"));
const UsageChart = lazy(() => import("@/web/pages/dashboard/usage/components/UsageChart"));

const STATS_REFETCH_DEBOUNCE_MS = 2000;

function isUsageTopologyProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm") || p.serviceKinds.includes("systemone");
}

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [], onOpenDetails }) {
  return (
    <Card padding="none" className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line py-2.5">
        <h2 className="text-sm font-semibold text-ink">Recent requests</h2>
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex items-center text-[12.5px] font-semibold text-ink underline underline-offset-[3px] transition-opacity hover:opacity-80 max-sm:min-h-11 max-sm:-mr-2 max-sm:px-2"
          >
            View details
          </button>
        ) : null}
      </div>

      {!requests.length ? (
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[280px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-bg">
              <tr className="border-b border-line text-muted">
                <th className="w-3 py-2 text-left font-medium" aria-label="Status" />
                <th className="py-2 text-left font-medium">Model</th>
                <th className="py-2 text-right font-medium whitespace-nowrap">In / out</th>
                <th className="py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="transition-colors hover:bg-raise/70">
                    <td className="py-2">
                      <span className={`block size-1.5 rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />
                    </td>
                    <td className="max-w-[140px] truncate py-2 pr-2 font-mono text-ink" title={r.model}>{r.model}</td>
                    <td className="whitespace-nowrap py-2 text-right font-mono tabular-nums text-ink">
                      {fmt(r.promptTokens)}
                      <span aria-hidden="true" className="px-1 text-faint">→</span>
                      {fmt(r.completionTokens)}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-2 text-right font-mono tabular-nums text-faint">
                      <TimeAgo timestamp={r.timestamp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, (data.promptTokens || 0) - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, cachedCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unknown Model";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": return item.keyName || "Unknown Key";
    case "endpoint": return item.endpoint || "Unknown Endpoint";
    default: return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API key name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const VIEW_MODE_OPTIONS = [
  { value: "costs", label: "Costs" },
  { value: "tokens", label: "Tokens" },
];

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false, onOpenDetails } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;
  const periodRef = useRef(period);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, nodesData]) => {
        const nodeNameMap = {};
        for (const node of (nodesData?.nodes || [])) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || []).filter((c) => {
          if (c.isActive === false) return false;
          if (!isUsageTopologyProvider(c.provider)) return false;
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        }).map((c) => ({
          ...c,
          nodeName: nodeNameMap[c.provider] || null,
        }));
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !seen.has(p.id) && isUsageTopologyProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoading(true);
    } else {
      setFetching(true);
    }

    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setFetching(false);
      });
  }, [period]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    let refetchTimer = null;
    const scheduleRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        fetch(`/api/usage/stats?period=${periodRef.current}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => { if (data) setStats((prev) => ({ ...prev, ...data })); })
          .catch(() => {});
      }, STATS_REFETCH_DEBOUNCE_MS);
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          const pending = JSON.stringify(prev.pending) === JSON.stringify(data.pending) ? prev.pending : data.pending;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending,
          };
        });
        if (data.refresh) scheduleRefetch();
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => {
      clearTimeout(refetchTimer);
      es.close();
    };
  }, []);

  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const hasStats = Boolean(stats);
  const { byModel, byAccount, byApiKey, byEndpoint, pending } = stats || {};
  const activeTableConfig = useMemo(() => {
    if (!hasStats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(byModel, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="max-w-[260px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-ink" title={item.rawModel}>
                {item.pending > 0 ? <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-mark" /> : null}
                {item.rawModel}
              </td>
              <td className="px-3 py-2.5 sm:px-4">
                <Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm" dot={false} pill>
                  {item.provider}
                </Badge>
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (pending?.byAccount) {
          Object.entries(byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(byAccount, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-ink">
                {item.pending > 0 ? <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-mark" /> : null}
                {item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-ink">{item.rawModel}</td>
              <td className="px-3 py-2.5 sm:px-4">
                <Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm" dot={false} pill>
                  {item.provider}
                </Badge>
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-ink">{item.keyName}</td>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-muted">{item.rawModel}</td>
              <td className="px-3 py-2.5 sm:px-4">
                <Badge variant="neutral" size="sm" dot={false} pill>{item.provider}</Badge>
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(byEndpoint, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-faint">—</td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-ink">{item.endpoint}</td>
              <td className="max-w-[220px] truncate px-3 py-2.5 sm:px-4 font-mono text-[12.5px] text-muted">{item.rawModel}</td>
              <td className="px-3 py-2.5 sm:px-4">
                <Badge variant="neutral" size="sm" dot={false} pill>{item.provider}</Badge>
              </td>
              <td className="px-3 py-2.5 sm:px-4 text-right font-mono text-[12.5px] tabular-nums text-ink">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 text-right font-mono text-xs tabular-nums text-faint">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [hasStats, byModel, byAccount, byApiKey, byEndpoint, pending, tableView, sortBy, sortOrder]);

  if (!stats && !loading) return <div className="text-sm text-muted">Failed to load usage statistics.</div>;

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            disabled={fetching}
            size="sm"
            className="max-w-full"
          />
          {fetching && (
            <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[16px] text-muted">progress_activity</span>
          )}
        </div>
      )}

      {loading ? <Skeleton className="h-[72px] w-full rounded-md" /> : <OverviewCards stats={stats} />}

      {loading ? (
        <Skeleton className="h-[320px] w-full rounded-md sm:h-[480px]" />
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-5 lg:h-[480px] lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-md sm:h-[480px]" />}>
            <ProviderTopology
              providers={providers}
              activeRequests={stats.activeRequests || []}
              lastProvider={stats.recentRequests?.[0]?.provider || ""}
              errorProvider={stats.errorProvider || ""}
            />
          </Suspense>
          <RecentRequests requests={stats.recentRequests || []} onOpenDetails={onOpenDetails} />
        </div>
      )}

      {loading ? (
        <Skeleton className="h-[260px] w-full rounded-md" />
      ) : (
        <Suspense fallback={<Skeleton className="h-[260px] w-full rounded-md" />}>
          <UsageChart period={period} />
        </Suspense>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select
            aria-label="Breakdown view"
            value={tableView}
            onChange={(e) => setTableView(e.target.value)}
            className="h-9 max-sm:min-h-11 w-full rounded-md border border-line-strong bg-raise px-3 text-sm font-medium text-ink focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line sm:w-auto"
          >
            {TABLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <SegmentedControl
            options={VIEW_MODE_OPTIONS}
            value={viewMode}
            onChange={setViewMode}
            size="sm"
            className="self-start sm:self-auto"
          />
        </div>
        {loading ? (
          <Skeleton className="h-[200px] w-full rounded-md" />
        ) : activeTableConfig && (
          <UsageTable
            title=""
            columns={activeTableConfig.columns}
            groupedData={activeTableConfig.groupedData}
            tableType={tableView}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onToggleSort={toggleSort}
            viewMode={viewMode}
            storageKey={activeTableConfig.storageKey}
            renderSummaryCells={activeTableConfig.renderSummaryCells}
            renderDetailCells={activeTableConfig.renderDetailCells}
            emptyMessage={activeTableConfig.emptyMessage}
          />
        )}
      </div>
    </div>
  );
}
