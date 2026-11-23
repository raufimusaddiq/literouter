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

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-raise">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between bg-bg-alt/60 p-3 transition-colors hover:bg-bg-alt"
      >
        <div className="flex items-center gap-2">
          {icon && <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-muted">{icon}</span>}
          <span className="text-sm font-semibold text-ink">{title}</span>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            "material-symbols-outlined text-[18px] text-muted transition-transform duration-200",
            isOpen ? "rotate-90" : ""
          )}
        >
          chevron_right
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-line p-4">
          {children}
        </div>
      )}
    </div>
  );
}

function isErrorStatus(status) {
  return !!status && status !== "success" && status !== "ok";
}

function statusVariant(status) {
  if (status === "client_cancelled") return "warning";
  if (isErrorStatus(status)) return "error";
  return "success";
}

const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-line-strong bg-raise px-3 text-sm text-ink focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line";

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
      <Card variant="raised" padding="sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="provider-filter" className="text-[13px] font-medium text-ink">Provider</label>
            <select
              id="provider-filter"
              value={filters.provider}
              onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
              className={cn(INPUT_CLASS, "cursor-pointer")}
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="start-date-filter" className="text-[13px] font-medium text-ink">Start date</label>
            <input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="end-date-filter" className="text-[13px] font-medium text-ink">End date</label>
            <input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-[13px] font-medium text-ink opacity-0 lg:block" aria-hidden="true">Clear</span>
            <Button
              variant="secondary"
              onClick={handleClearFilters}
              disabled={!filters.provider && !filters.startDate && !filters.endDate}
              className="h-9 w-full"
            >
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

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
                    <dt className="text-faint">Latency</dt>
                    <dd className="mt-0.5 font-mono text-ink tabular-nums">
                      TTFT {detail.latency?.ttft || 0}ms / {detail.latency?.total || 0}ms
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
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-ink">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-muted">Timestamp:</span>{" "}
                <span className="font-mono text-ink tabular-nums">{formatDateTime(selectedDetail.timestamp)}</span>
              </div>
              <div>
                <span className="text-muted">Provider:</span>{" "}
                <span className="font-medium text-ink">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
              </div>
              <div>
                <span className="text-muted">Model:</span>{" "}
                <span className="font-mono text-ink">{selectedDetail.model}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted">Status:</span>
                <Badge variant={statusVariant(selectedDetail.status)} size="sm">
                  {selectedDetail.status || "unknown"}
                </Badge>
              </div>
              <div>
                <span className="text-muted">Latency:</span>{" "}
                <span className="font-mono text-ink tabular-nums">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-muted">Input tokens:</span>{" "}
                <span className="font-mono text-ink tabular-nums">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
              {getCachedTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-muted">Cached tokens:</span>{" "}
                  <span className="font-mono text-ink tabular-nums">
                    {getCachedTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              {getCacheCreationTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-muted">Cache creation:</span>{" "}
                  <span className="font-mono text-ink tabular-nums">
                    {getCacheCreationTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted">Output tokens:</span>{" "}
                <span className="font-mono text-ink tabular-nums">
                  {getOutputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
            </div>

            {selectedDetail.pxpipe && (
              <div className="rounded-md border border-line bg-raise p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-muted">image</span>
                  <span className="text-sm font-semibold text-ink">PXPIPE</span>
                  <Badge variant={selectedDetail.pxpipe.applied ? "success" : "warning"} size="sm">
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </Badge>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <span className="block text-xs text-muted">Original (est.)</span>
                      <span className="font-mono tabular-nums text-ink">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="block text-xs text-muted">Compressed (est.)</span>
                      <span className="font-mono tabular-nums text-ink">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="block text-xs text-muted">Saved</span>
                      <span className="font-mono tabular-nums text-ok">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="block text-xs text-muted">Images</span>
                      <span className="font-mono tabular-nums text-ink">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Reason: <span className="font-mono text-ink">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4">
              <CollapsibleSection title="1. Client request (input)" defaultOpen={true} icon="input">
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs text-ink sm:p-4">
                  {JSON.stringify(selectedDetail.request, null, 2)}
                </pre>
              </CollapsibleSection>

              {selectedDetail.providerRequest && (
                <CollapsibleSection title="2. Provider request (translated)" icon="translate">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs text-ink sm:p-4">
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                </CollapsibleSection>
              )}

              {selectedDetail.providerResponse && (
                <CollapsibleSection title="3. Provider response (raw)" icon="data_object">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs text-ink sm:p-4">
                    {typeof selectedDetail.providerResponse === "object"
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : selectedDetail.providerResponse}
                  </pre>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="4. Client response (final)" defaultOpen={true} icon="output">
                {selectedDetail.response?.thinking && (
                  <div className="mb-4">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">psychology</span>
                      Thinking process
                    </h4>
                    <pre className="max-h-[200px] max-w-full overflow-auto rounded-md border border-line-strong bg-bg p-3 font-mono text-xs text-ink sm:p-4">
                      {selectedDetail.response.thinking}
                    </pre>
                  </div>
                )}

                <h4 className="mb-2 text-xs font-semibold text-muted">
                  Content
                </h4>
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs text-ink sm:p-4">
                  {selectedDetail.response?.content || "[No content]"}
                </pre>
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
