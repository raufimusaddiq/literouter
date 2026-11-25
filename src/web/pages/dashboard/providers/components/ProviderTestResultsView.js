"use client";

import PropTypes from "prop-types";
import { Badge } from "@/shared/components";

export default function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="py-6 text-center">
        <span aria-hidden="true" className="material-symbols-outlined mb-2 block text-[32px] text-danger">
          error
        </span>
        <p className="text-sm text-danger">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    {
      oauth: "OAuth",
      free: "Free",
      apikey: "API Key",
      systemone: "System One",
      provider: "Provider",
      all: "All",
    }[mode] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3 text-xs">
          <span className="font-medium text-ink">{modeLabel} test</span>
          <Badge variant="success" size="sm" dot>
            {summary.passed} passed
          </Badge>
          {summary.failed > 0 && (
            <Badge variant="error" size="sm" dot>
              {summary.failed} failed
            </Badge>
          )}
          <span className="font-mono tabular-nums text-faint sm:ml-auto">
            {summary.total} tested
          </span>
        </div>
      )}
      {items.length > 0 && (
        <div className="flex flex-col divide-y divide-line border-b border-line">
          {items.map((r, i) => (
            <div
              key={r.connectionId || i}
              className="flex min-w-0 flex-wrap items-center gap-2 py-2.5 text-xs sm:flex-nowrap"
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${r.valid ? "bg-ok" : "bg-danger"}`}
              />
              <div className="min-w-0 flex-[1_1_160px]">
                <span className="block truncate font-medium text-ink sm:inline">
                  {r.connectionName}
                </span>
                <span className="block truncate text-muted sm:ml-1.5 sm:inline">
                  ({r.provider})
                </span>
              </div>
              {r.latencyMs !== undefined && (
                <span className="shrink-0 font-mono tabular-nums text-faint">
                  {r.latencyMs}ms
                </span>
              )}
              <Badge
                variant={r.valid ? "success" : "error"}
                size="sm"
                dot={false}
                className="shrink-0 font-mono"
              >
                {r.valid ? "OK" : r.diagnosis?.type || "Error"}
              </Badge>
            </div>
          ))}
        </div>
      )}
      {items.length === 0 && (
        <div className="py-4 text-center text-sm text-muted">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResultsView.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
