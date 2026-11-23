"use client";


import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const STATUS_CONFIG = {
  available: { icon: "check_circle", dotClass: "bg-ok", textClass: "text-ok", label: "Available" },
  cooldown: { icon: "schedule", dotClass: "bg-warning", textClass: "text-warning", label: "Cooldown" },
  unavailable: { icon: "error", dotClass: "bg-danger", textClass: "text-danger", label: "Unavailable" },
  unknown: { icon: "help", dotClass: "bg-faint", textClass: "text-faint", label: "Unknown" },
};

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(null);
  const ref = useRef(null);
  const notify = useNotificationStore();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (!document.hidden) fetchStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleClearCooldown = async (provider, model) => {
    setClearing(`${provider}:${model}`);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearCooldown", provider, model }),
      });
      if (res.ok) {
        notify.success(`Cooldown cleared for ${model}`);
        await fetchStatus();
      } else {
        notify.error("Failed to clear cooldown");
      }
    } catch {
      notify.error("Failed to clear cooldown");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;

  const byProvider = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  return (
    <div className="relative" ref={ref}>

      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-line-strong bg-raise shadow-[var(--shadow-float)]">
          <div className="flex items-center justify-between border-b border-line bg-bg px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${isHealthy ? "bg-ok" : "bg-warning"}`}
              />
              <span className="text-sm font-semibold text-ink">Model Status</span>
            </div>
            <button
              type="button"
              onClick={fetchStatus}
              className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              title="Refresh"
              aria-label="Refresh model status"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto px-4 py-3">
            {isHealthy ? (
              <p className="py-2 text-center text-sm text-muted">
                All models are responding normally.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {Object.entries(byProvider).map(([provider, provModels]) => (
                  <div key={provider}>
                    <p className="mb-1.5 text-xs font-semibold capitalize text-ink">{provider}</p>
                    <div className="flex flex-col divide-y divide-line border-t border-line">
                      {provModels.map((m) => {
                        const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                        const isClearing = clearing === `${m.provider}:${m.model}`;
                        return (
                          <div
                            key={`${m.provider}-${m.model}`}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                aria-hidden="true"
                                className={`size-1.5 shrink-0 rounded-full ${status.dotClass}`}
                              />
                              <span className="truncate font-mono text-xs text-ink">{m.model}</span>
                            </div>
                            {m.status === "cooldown" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClearCooldown(m.provider, m.model)}
                                disabled={isClearing}
                                className="ml-2 h-6 px-2 text-[11px]"
                              >
                                {isClearing ? "..." : "Clear"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
