"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import Toggle from "./Toggle";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        if (!document.hidden) fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">Request logs</h2>
        <Toggle
          size="sm"
          checked={autoRefresh}
          onChange={setAutoRefresh}
          label="Auto refresh (3s)"
        />
      </div>

      <Card variant="raised" padding="none" className="overflow-hidden">
        <div className="max-h-[600px] overflow-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center font-sans text-sm text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center font-sans text-sm text-muted">No logs recorded yet.</div>
          ) : (
            <table className="w-full border-collapse whitespace-nowrap text-left">
              <thead className="sticky top-0 z-10 border-b border-line-strong bg-bg-alt text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & time</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map((log, i) => {
                  const parts = log.split(" | ");
                  if (parts.length < 7) return null;

                  const status = parts[6];
                  const isPending = status.includes("PENDING");
                  const isFailed = status.includes("FAILED");
                  const isSuccess = status.includes("OK");

                  return (
                    <tr key={i} className={`transition-colors hover:bg-bg-alt/60 ${isPending ? "bg-mark/10" : ""}`}>
                      <td className="px-3 py-1.5 text-faint tabular-nums">{parts[0]}</td>
                      <td className="px-3 py-1.5 font-medium text-ink">{parts[1]}</td>
                      <td className="px-3 py-1.5">
                        <span className="rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-muted">
                          {parts[2]}
                        </span>
                      </td>
                      <td className="max-w-[150px] truncate px-3 py-1.5 text-muted" title={parts[3]}>{parts[3]}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink">{parts[4]}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink">{parts[5]}</td>
                      <td
                        className={`px-3 py-1.5 font-semibold ${
                          isSuccess
                            ? "text-ok"
                            : isFailed
                              ? "text-danger"
                              : "text-mark-line"
                        }`}
                      >
                        {status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <p className="text-xs text-faint">
        Logs are loaded from the request history database.
      </p>
    </div>
  );
}
