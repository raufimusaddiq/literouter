"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";
import Badge from "./Badge";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

export default function NoAuthProxyCard({ providerId }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
      setRotateStrategy(override.rotateStrategy || "none");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const save = useCallback(async (poolId, strategy) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = { ...(current[providerId] || {}) };
      if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId;
      else override.proxyPoolId = poolId;
      if (strategy === "none") delete override.rotateStrategy;
      else override.rotateStrategy = strategy;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save proxy config error:", e);
    } finally {
      setSaving(false);
    }
  }, [providerId]);

  const handlePoolChange = (newPoolId) => {
    setProxyPoolId(newPoolId);
    save(newPoolId, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy) => {
    setRotateStrategy(newStrategy);
    save(proxyPoolId, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-ok/30 bg-ok/10 text-ok">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">lock_open</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">No authentication required</p>
          <p className="text-xs text-muted">This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits.</p>
        </div>
        {savedFlash && <Badge variant="success" size="sm" dot>Saved</Badge>}
      </div>

      <Card variant="raised" padding="sm" className="flex flex-col gap-4">
        <Select
          label="Proxy Pool"
          value={proxyPoolId}
          onChange={(e) => handlePoolChange(e.target.value)}
          disabled={saving || isRotation}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
            ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
          hint={isRotation ? "Pool selector is ignored when rotation is active — all active pools are used." : undefined}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-ink">Rotation Strategy</label>
          <div className="relative">
            <select
              value={rotateStrategy}
              onChange={(e) => handleStrategyChange(e.target.value)}
              disabled={saving}
              className="h-9 w-full appearance-none rounded-md border border-line-strong bg-raise px-3 pr-9 text-sm text-ink transition-[background-color,border-color,box-shadow] focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line disabled:cursor-not-allowed disabled:opacity-50"
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">expand_more</span>
            </div>
          </div>
          <p className="text-xs text-muted">
            {!canRotate
              ? `Need at least 2 active proxy pools for rotation.`
              : isRotation
                ? rotateStrategy === "round-robin"
                  ? `Rotating through all ${proxyPools.length} active pools in order. State is in-memory (resets on restart).`
                  : `Picking a random pool from ${proxyPools.length} active pools each request.`
                : `Uses the selected pool above. Set to Round-robin or Random to rotate across all active pools.`}
          </p>
        </div>
      </Card>
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};
