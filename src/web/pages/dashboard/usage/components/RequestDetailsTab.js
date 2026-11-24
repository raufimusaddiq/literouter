"use client";

import { formatDateTime } from "@/shared/utils/dateTime";
import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { getInputTokens, getOutputTokens, getCachedTokens, getCacheCreationTokens } from "./tokenDisplay";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache,
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === "string") {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function isRedacted(value) {
  return !!value && typeof value === "object" && value.redacted === true && Object.keys(value).length === 1;
}

function formatMs(value) {
  return `${Number(value || 0).toLocaleString()} ms`;
}

function Stat({ value, label }) {
  return (
    <div className="min-w-0">
      <strong className="block truncate text-[22px] leading-[26px] font-semibold tracking-[-0.03em] text-ink [font-variant-numeric:proportional-nums]">
        {value}
      </strong>
      <span className="mt-1 block text-xs text-muted">{label}</span>
    </div>
  );
}

function PayloadRow({ index, title, children, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <li>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:text-ink max-sm:min-h-[44px]"
      >
        <span className="w-6 shrink-0 font-mono text-xs text-faint tabular-nums">{String(index).padStart(2, "0")}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{title}</span>
        <span
          aria-hidden="true"
          className={cn("material-symbols-outlined text-[18px] text-muted transition-transform duration-200", isOpen && "rotate-90")}
        >
          chevron_right
        </span>
      </button>
      {isOpen && <div className="pb-4 pl-9">{children}</div>}
    </li>
  );
}

const PRE_CLASS = "max-h-[300px] max-w-full overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-[18px] text-ink";

function asText(value) {
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function isErrorStatus(status) {
  return !!status && status !== "success" && status !== "ok";
}

function statusVariant(status) {
  if (status === "client_cancelled") return "warning";
  if (isErrorStatus(status)) return "error";
  return "success";
}

const FIELD_CLASS =
  "block h-9 w-full min-w-0 max-w-full appearance-none rounded-md border border-line-strong bg-raise pl-3 pr-9 text-[16px] text-ink transition-[border-color,box-shadow] duration-150 focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line max-sm:min-h-11 sm:text-sm";

function FieldIcon({ name }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted">
      <span className="material-symbols-outlined text-[18px]">{name}</span>
    </span>
  );
}

function DateTimeField({ id, label, value, onChange }) {
  const [focused, setFocused] = useState(false);
  const empty = !value;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">{label}</label>
      <div className="relative min-w-0">
        <input
          id={id}
          type="datetime-local"
          value={value}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(FIELD_CLASS, "lr-datetime relative cursor-pointer tabular-nums", empty && !focused && "text-transparent")}
        />
        {empty && !focused && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[16px] text-faint sm:text-sm">
            Any time
          </span>
        )}
        <FieldIcon name="calendar_today" />
      </div>
    </div>
  );
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: "",
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="Filters" className="border-b border-line pb-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Filters</h2>
          <button
            type="button"
            onClick={handleClearFilters}
            disabled={!filters.provider && !filters.startDate && !filters.endDate}
            className="text-[13px] font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-40 max-sm:min-h-11 max-sm:px-2"
          >
            Clear
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5 lg:col-span-1">
            <label htmlFor="provider-filter" className="text-[13px] font-medium text-ink">Provider</label>
            <div className="relative min-w-0">
              <select
                id="provider-filter"
                value={filters.provider}
                onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
                className={cn(FIELD_CLASS, "cursor-pointer truncate")}
              >
                <option value="">All providers</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <FieldIcon name="expand_more" />
            </div>
          </div>
          <DateTimeField
            id="start-date-filter"
            label="From"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />
          <DateTimeField
            id="end-date-filter"
            label="To"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />
        </div>
      </section>

      <Card padding="none">
        <ul className="divide-y divide-line lg:hidden">
          {loading ? (
            <li className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              Loading...
            </li>
          ) : details.length === 0 ? (
            <li className="p-8 text-center text-sm text-muted">No request details found</li>
          ) : (
            details.map((detail, index) => (
              <li key={`m-${detail.id}-${index}`} className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px] text-ink">{detail.model}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{getProviderName(detail.provider, providerNameCache)}</p>
                  </div>
                  <Badge variant={statusVariant(detail.status)} size="sm" className="shrink-0">
                    {detail.status || "unknown"}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-faint">Timestamp</dt>
                    <dd className="mt-0.5 font-mono text-ink tabular-nums">{formatDateTime(detail.timestamp)}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">TTFT / total</dt>
                    <dd className="mt-0.5 font-mono text-ink tabular-nums">
                      {formatMs(detail.latency?.ttft)} / {formatMs(detail.latency?.total)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">Input</dt>
                    <dd className="mt-0.5 font-mono text-ink tabular-nums">{getInputTokens(detail.tokens).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Output</dt>
                    <dd className="mt-0.5 font-mono text-ink tabular-nums">{getOutputTokens(detail.tokens).toLocaleString()}</dd>
                  </div>
                  {getCachedTokens(detail.tokens) > 0 && (
                    <div>
                      <dt className="text-faint">Cached</dt>
                      <dd className="mt-0.5 font-mono text-ink tabular-nums">{getCachedTokens(detail.tokens).toLocaleString()}</dd>
                    </div>
                  )}
                  {getCacheCreationTokens(detail.tokens) > 0 && (
                    <div>
                      <dt className="text-faint">Cache creation</dt>
                      <dd className="mt-0.5 font-mono text-ink tabular-nums">{getCacheCreationTokens(detail.tokens).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>
                <Button variant="outline" size="sm" onClick={() => handleViewDetail(detail)} className="w-full">
                  Detail
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-line-strong text-xs font-medium text-muted">
                <th className="px-3 py-2.5 text-left font-medium">Timestamp</th>
                <th className="px-3 py-2.5 text-left font-medium">Model</th>
                <th className="px-3 py-2.5 text-left font-medium">Provider</th>
                <th className="px-3 py-2.5 text-right font-medium">Input tokens</th>
                <th className="px-3 py-2.5 text-right font-medium">Cached</th>
                <th className="px-3 py-2.5 text-right font-medium">Cache creation</th>
                <th className="px-3 py-2.5 text-right font-medium">Output tokens</th>
                <th className="px-3 py-2.5 text-right font-medium">Latency</th>
                <th className="px-3 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-muted">
                    No request details found
                  </td>
                </tr>
              ) : (
                details.map((detail, index) => (
                  <tr
                    key={`${detail.id}-${index}`}
                    className="transition-colors hover:bg-raise/70"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted tabular-nums">
                      {formatDateTime(detail.timestamp)}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-mono text-[12.5px] text-ink" title={detail.model}>
                      {detail.model}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-[13px] text-ink">
                      {getProviderName(detail.provider, providerNameCache)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-ink tabular-nums">
                      {getInputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-muted tabular-nums">
                      {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-muted tabular-nums">
                      {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-ink tabular-nums">
                      {getOutputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
                      <div>TTFT {detail.latency?.ttft || 0}ms</div>
                      <div className="text-faint">Total {detail.latency?.total || 0}ms</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetail(detail)}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request details"
        width="lg"
      >
        {selectedDetail && (() => {
          const d = selectedDetail;
          const cached = getCachedTokens(d.tokens);
          const cacheCreation = getCacheCreationTokens(d.tokens);
          const payloads = [
            { key: "request", title: "Client request", value: d.request, open: true },
            { key: "providerRequest", title: "Provider request (translated)", value: d.providerRequest },
            { key: "providerResponse", title: "Provider response (raw)", value: d.providerResponse },
          ].filter((entry) => entry.value !== undefined && entry.value !== null && !isRedacted(entry.value));
          const responseRedacted = isRedacted(d.response);
          const hasResponse = !responseRedacted && (d.response?.content || d.response?.thinking);
          const allRedacted = payloads.length === 0 && !hasResponse;
          return (
            <div className="flex min-w-0 flex-col gap-6">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-[15px] leading-[22px] text-ink">{d.model}</p>
                  <p className="mt-1 text-sm text-muted">{getProviderName(d.provider, providerNameCache)}</p>
                </div>
                <Badge variant={statusVariant(d.status)} size="sm" className="shrink-0">
                  {d.status || "unknown"}
                </Badge>
              </header>

              <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-line py-5 sm:grid-cols-3">
                <Stat value={getInputTokens(d.tokens).toLocaleString()} label="input tokens" />
                <Stat value={getOutputTokens(d.tokens).toLocaleString()} label="output tokens" />
                {cached > 0 && <Stat value={cached.toLocaleString()} label="cached tokens" />}
                {cacheCreation > 0 && <Stat value={cacheCreation.toLocaleString()} label="cache creation" />}
                <Stat value={formatMs(d.latency?.ttft)} label="time to first token" />
                <Stat value={formatMs(d.latency?.total)} label="total latency" />
              </div>

              <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-muted">Timestamp</dt>
                  <dd className="mt-1 font-mono text-[13px] text-ink tabular-nums">{formatDateTime(d.timestamp)}</dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-muted">Request ID</dt>
                  <dd className="mt-1 break-all font-mono text-[13px] text-ink">{d.id}</dd>
                </div>
              </dl>

              {d.pxpipe && (
                <section className="border-t border-line pt-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">PXPIPE</h3>
                    <Badge variant={d.pxpipe.applied ? "success" : "warning"} size="sm">
                      {d.pxpipe.applied ? "Activated" : "Skipped"}
                    </Badge>
                  </div>
                  {d.pxpipe.applied ? (
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                      <Stat value={(d.pxpipe.tokensBeforeEst || 0).toLocaleString()} label="original (est.)" />
                      <Stat value={(d.pxpipe.tokensAfterEst || 0).toLocaleString()} label="compressed (est.)" />
                      <Stat value={`${d.pxpipe.savedPct || 0}%`} label="saved" />
                      <Stat value={`${d.pxpipe.imageCount || 0}`} label={`images, ${formatMs(d.pxpipe.durationMs)}`} />
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted">
                      Reason: <span className="font-mono text-ink">{d.pxpipe.reason}</span>
                      {d.pxpipe.detail ? ` — ${d.pxpipe.detail}` : ""}
                    </p>
                  )}
                </section>
              )}

              <section className="border-t border-line pt-5">
                <h3 className="text-sm font-semibold text-ink">Payloads</h3>
                {allRedacted ? (
                  <p className="mt-2 text-sm text-muted">
                    Request and response bodies are redacted here, so only metadata is shown.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line border-y border-line">
                    {payloads.map((entry, i) => (
                      <PayloadRow key={entry.key} index={i + 1} title={entry.title} defaultOpen={entry.open}>
                        <pre className={PRE_CLASS}>{asText(entry.value)}</pre>
                      </PayloadRow>
                    ))}
                    {hasResponse && (
                      <PayloadRow index={payloads.length + 1} title="Client response" defaultOpen>
                        {d.response.thinking && (
                          <>
                            <p className="mb-2 text-xs text-muted">Thinking</p>
                            <pre className={cn(PRE_CLASS, "mb-4 max-h-[200px]")}>{d.response.thinking}</pre>
                          </>
                        )}
                        <p className="mb-2 text-xs text-muted">Content</p>
                        <pre className={PRE_CLASS}>{d.response.content || "No content"}</pre>
                      </PayloadRow>
                    )}
                  </ul>
                )}
              </section>
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}
