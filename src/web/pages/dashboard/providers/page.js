"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import {
  CardSkeleton,
  Badge,
  Button,
  Modal,
  Toggle,
} from "@/shared/components";
import { HeaderControls } from "@/shared/components/shell/HeaderControls";
import PageHeader from "@/shared/components/shell/PageHeader";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
  supportsServiceKind,
} from "@/shared/constants/providers";
import { Link } from "@/web/router";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { getConnectionHealthStats, HEALTH_LABELS } from "@/shared/utils/connectionHealth";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";
import { STATUS_FILTER_OPTIONS, matchesStatusFilter } from "./utils";

function getStatusDisplay(connected, error, errorCode) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {connected} Connected
      </Badge>,
    );
  }
  if (error > 0) {
    const errText = errorCode
      ? `${error} Error (${errorCode})`
      : `${error} Error`;
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>,
    );
  }
  if (parts.length === 0) {
    return <span className="text-faint">No connections</span>;
  }
  return parts;
}

function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime") ||
    msg.includes("not runnable") ||
    msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

const APIKEY_INITIAL_VISIBLE = 20;

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [showAddSystemOneModal, setShowAddSystemOneModal] = useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const matchSearch = (name) => {
    if (!searchQuery.trim()) return true;
    if (!name) return false;
    return name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  const sortByPriority = (entries, authType) =>
    [...entries].sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(ka, authType);
      const sb = getProviderStats(kb, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  const sortItemsByPriority = (items, authType) =>
    [...items].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(a.id, authType);
      const sb = getProviderStats(b.id, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok)
          setConnections(connectionsData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const providerStatsCache = new Map();
  const getProviderStats = (providerId, authType) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const cacheKey = `${providerId}\u0000${authTypes.join(",")}`;
    const cached = providerStatsCache.get(cacheKey);
    if (cached) return cached;
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && authTypes.includes(c.authType),
    );

    const getEffectiveStatus = (conn) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) =>
          k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
      );
      return conn.testStatus === "unavailable" && !isCooldown
        ? "active"
        : conn.testStatus;
    };

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConns = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return (
        status === "error" || status === "expired" || status === "unavailable"
      );
    });

    const error = errorConns.length;
    const total = providerConnections.length;
    const allDisabled =
      total > 0 && providerConnections.every((c) => c.isActive === false);

    const latestError = errorConns.sort(
      (a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0),
    )[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt
      ? getRelativeTime(latestError.lastErrorAt)
      : null;

    const stats = { connected, error, total, errorCode, errorTime, allDisabled };
    providerStatsCache.set(cacheKey, stats);
    return stats;
  };

  const matchStatus = (stats, isNoAuth) =>
    matchesStatusFilter(statusFilter, stats, isNoAuth);

  const handleToggleProvider = async (providerId, authType, newActive) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) =>
      c.provider === providerId && authTypes.includes(c.authType);
    const providerConns = connections.filter(matches);
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  const handleBatchTest = async (mode, providerId = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch (error) {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }))
    .filter(
      (p) => matchSearch(p.name) && matchStatus(getProviderStats(p.id, "apikey")),
    );

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }))
    .filter(
      (p) => matchSearch(p.name) && matchStatus(getProviderStats(p.id, "apikey")),
    );

  const dualAuthTypes = (info, key) => {
    if (key === "kiro") return ["oauth", "apikey", "api_key"];
    const modes = info?.authModes;
    if (!Array.isArray(modes)) {
      return key in FREE_TIER_PROVIDERS || key in APIKEY_PROVIDERS
        ? ["oauth", "apikey", "api_key"]
        : "oauth";
    }
    if (!modes.includes("apikey")) return "oauth";
    return ["oauth", "apikey", "api_key"];
  };

  const oauthEntries = sortByPriority(
    Object.entries(OAUTH_PROVIDERS).filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    ),
    "oauth",
  );
  const freeEntries = Object.entries(FREE_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    )
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  const freeTierEntries = Object.entries(FREE_TIER_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        (supportsServiceKind(info, "llm") || supportsServiceKind(info, "systemone")) &&
        matchStatus(getProviderStats(key, dualAuthTypes(info, key)), info.noAuth),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = getProviderStats(ka, dualAuthTypes(a, ka)).connected > 0 ? 0 : 1;
      const cb = getProviderStats(kb, dualAuthTypes(b, kb)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        supportsServiceKind(info, "llm") &&
        !supportsServiceKind(info, "systemone") &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, "apikey"), info.noAuth),
    )
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const systemOneEntries = Object.entries(APIKEY_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        supportsServiceKind(info, "systemone") &&
        matchSearch(info.name) &&
        matchStatus(getProviderStats(key, "apikey"), info.noAuth),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const systemOneNodes = providerNodes
    .filter((node) => node.type === "systemone")
    .map((node) => ({
      id: node.id,
      name: node.name || "System One Node",
      color: "#E551BA",
      textIcon: "S1",
    }))
    .filter(
      (p) => matchSearch(p.name) && matchStatus(getProviderStats(p.id, "apikey")),
    );
  const isApikeySearching = !!searchQuery.trim() || statusFilter !== "all";
  const visibleApikeyEntries =
    isApikeySearching || showAllApikey
      ? apikeyEntries
      : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAnyResult =
    oauthEntries.length > 0 ||
    freeEntries.length > 0 ||
    freeTierEntries.length > 0 ||
    systemOneEntries.length > 0 ||
    systemOneNodes.length > 0 ||
    apikeyEntries.length > 0 ||
    compatibleProviders.length > 0 ||
    anthropicCompatibleProviders.length > 0;

  const health = getConnectionHealthStats(connections);

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <PageHeader
        title="Providers"
        description={
          <span id="needs-attention" className="scroll-mt-24">
            {health.total} {health.total === 1 ? "connection" : "connections"} · {health.ready} {HEALTH_LABELS.ready.toLowerCase()} · {health.attention} {health.attention === 1 ? "needs" : "need"} attention{health.inactive > 0 ? ` · ${health.inactive} inactive` : ""}{health.untested > 0 ? ` · ${health.untested} untested` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HeaderControls />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 max-sm:min-h-11 rounded-md border border-line-strong bg-raise px-2.5 text-xs font-medium text-ink outline-none transition-colors hover:border-ink/40 focus:border-mark-line focus:ring-2 focus:ring-mark-line"
              aria-label="Filter providers by connection status"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {health.attentionItems.length > 0 && (
        <ul
          className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-raise px-4 py-3 text-sm text-muted"
          data-testid="needs-attention-list"
        >
          {health.attentionItems.map(({ connection, reason }) => (
            <li key={connection.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
              <Link href={`/dashboard/providers/${connection.provider}`} className="font-medium text-ink hover:underline">
                {connection.name || connection.email || connection.provider}
              </Link>
              <span className="text-faint">·</span>
              <span className="text-warning">{reason.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
      )}

      {!hasAnyResult && (
        <div className="border-y border-dashed border-line-strong py-8 text-center">
          <span aria-hidden="true" className="material-symbols-outlined mb-2 text-[32px] text-faint">
            search_off
          </span>
          <p className="text-sm text-muted">
            No providers match your search or filters
          </p>
        </div>
      )}

      <section className="flex flex-col gap-3 border-t border-line-strong pt-5">
        <div data-section-header="" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
            Custom Providers (OpenAI/Anthropic Compatible)
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="whitespace-nowrap"
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="whitespace-nowrap"
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-y border-dashed border-line py-4 text-sm text-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-faint">extension</span>
            <span>No custom providers — use buttons above to add OpenAI/Anthropic compatible endpoints</span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
              (info) => (
                <ApiKeyProviderCard
                  key={info.id}
                  providerId={info.id}
                  provider={info}
                  stats={getProviderStats(info.id, "apikey")}
                  authType="compatible"
                  onToggle={(active) =>
                    handleToggleProvider(info.id, "apikey", active)
                  }
                />
              ),
            )}
          </div>
        )}
      </section>

      {(systemOneEntries.length > 0 || systemOneNodes.length > 0) && (
      <section className="flex flex-col gap-3 border-t border-line-strong pt-5">
        <div data-section-header="" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">System One providers</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Typed decision APIs with their own request format and model catalog.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddSystemOneModal(true)}
              className="whitespace-nowrap"
            >
              Add System One
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="play_arrow"
              loading={testingMode === "systemone"}
              disabled={!!testingMode}
              onClick={() => handleBatchTest("systemone")}
              title="Test all System One connections"
              aria-label="Test all System One connections"
              className="whitespace-nowrap"
            >
              {testingMode === "systemone" ? "Testing..." : "Test All"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {[...systemOneEntries.map(([key, info]) => ({ key, info })), ...systemOneNodes.map((node) => ({ key: node.id, info: node }))].map(({ key, info }) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
      </section>
      )}

      {oauthEntries.length > 0 && (
      <section className="flex flex-col gap-3 border-t border-line-strong pt-5">
        <div data-section-header="" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
            OAuth Providers
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <ModelAvailabilityBadge />
            <Button
              size="sm"
              variant="secondary"
              icon="play_arrow"
              loading={testingMode === "oauth"}
              disabled={!!testingMode}
              onClick={() => handleBatchTest("oauth")}
              title="Test all OAuth connections"
              aria-label="Test all OAuth connections"
              className="whitespace-nowrap"
            >
              {testingMode === "oauth" ? "Testing..." : "Test All"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {oauthEntries.map(([key, info]) => {
            const authTypes = dualAuthTypes(info, key);
            return (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, authTypes)}
                authType="oauth"
                onToggle={(active) => handleToggleProvider(key, authTypes, active)}
              />
            );
          })}
        </div>
      </section>
      )}

      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
      <section className="flex flex-col gap-3 border-t border-line-strong pt-5">
        <div data-section-header="" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
            Free Tier Providers
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="play_arrow"
              loading={testingMode === "free"}
              disabled={!!testingMode}
              onClick={() => handleBatchTest("free")}
              title="Test all Free connections"
              aria-label="Test all Free provider connections"
              className="whitespace-nowrap"
            >
              {testingMode === "free" ? "Testing..." : "Test All"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {freeEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType="free"
                onToggle={(active) =>
                  handleToggleProvider(key, freeAuthTypes, active)
                }
              />
            );
          })}
          {freeTierEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType={Array.isArray(freeAuthTypes) ? (freeAuthTypes[0] ?? "apikey") : freeAuthTypes}
                onToggle={(active) => handleToggleProvider(key, freeAuthTypes, active)}
              />
            );
          })}
        </div>
      </section>
      )}

      {apikeyEntries.length > 0 && (
      <section className="flex flex-col gap-3 border-t border-line-strong pt-5">
        <div data-section-header="" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">
            API Key Providers
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="play_arrow"
              loading={testingMode === "apikey"}
              disabled={!!testingMode}
              onClick={() => handleBatchTest("apikey")}
              title="Test all API Key connections"
              aria-label="Test all API Key connections"
              className="whitespace-nowrap"
            >
              {testingMode === "apikey" ? "Testing..." : "Test All"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {visibleApikeyEntries.map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
        {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 && (
          <Button
            variant="secondary"
            icon="expand_more"
            fullWidth
            onClick={() => setShowAllApikey(true)}
          >
            Show all {apikeyEntries.length} providers
          </Button>
        )}
      </section>
      )}


      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="systemone"
        isOpen={showAddSystemOneModal}
        onClose={() => setShowAddSystemOneModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddSystemOneModal(false);
        }}
      />

      <Modal
        isOpen={!!testResults}
        onClose={() => setTestResults(null)}
        title="Test Results"
        size="lg"
      >
        {testResults && <ProviderTestResultsView results={testResults} />}
      </Modal>
    </div>
  );
}

function ProviderCard({ providerId, provider, stats, authType, onToggle }) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  return (
    <Link
      href={`/dashboard/providers/${providerId}`}
      className={`group flex min-w-0 items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-raise focus-visible:bg-raise ${allDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-raise">
          <ProviderIcon
            src={`/providers/${provider.id}.png`}
            alt={provider.name}
            size={24}
            className="max-h-6 max-w-6 rounded object-contain"
            fallbackText={
              provider.textIcon || provider.id.slice(0, 2).toUpperCase()
            }
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{provider.name}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {allDisabled ? (
              <Badge variant="default" size="sm" dot>
                Disabled
              </Badge>
            ) : isNoAuth ? (
              <Badge variant="success" size="sm" dot>Ready</Badge>
            ) : (
              <>
                {getStatusDisplay(connected, error, errorCode)}
                {errorTime && (
                  <span className="font-mono text-faint">{errorTime}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {stats.total > 0 && (
          <div
            className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
          >
            <Toggle
              size="sm"
              checked={!allDisabled}
              onChange={() => {}}
              title={allDisabled ? "Enable provider" : "Disable provider"}
              aria-label={allDisabled ? "Enable provider" : "Disable provider"}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (isCompatible && provider.apiType)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return getProviderIconSrc(provider.id);
  };

  return (
    <Link
      href={`/dashboard/providers/${providerId}`}
      className={`group flex min-w-0 items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-raise focus-visible:bg-raise ${allDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-raise">
          <ProviderIcon
            src={getIconPath()}
            alt={provider.name}
            size={24}
            className="max-h-6 max-w-6 rounded object-contain"
            fallbackText={
              provider.textIcon || provider.id.slice(0, 2).toUpperCase()
            }
            fallbackColor={provider.color}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{provider.name}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {allDisabled ? (
              <Badge variant="default" size="sm" dot>
                Disabled
              </Badge>
            ) : (
              <>
                {getStatusDisplay(connected, error, errorCode)}
                {isCompatible && (
                  <Badge variant="default" size="sm" dot={false} pill>
                    {provider.apiType === "responses"
                      ? "Responses"
                      : "Chat"}
                  </Badge>
                )}
                {isAnthropicCompatible && (
                  <Badge variant="default" size="sm" dot={false} pill>
                    Messages
                  </Badge>
                )}
                {errorTime && (
                  <span className="font-mono text-faint">{errorTime}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {stats.total > 0 && (
          <div
            className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(!allDisabled ? false : true);
            }}
          >
            <Toggle
              size="sm"
              checked={!allDisabled}
              onChange={() => {}}
              title={allDisabled ? "Enable provider" : "Disable provider"}
              aria-label={allDisabled ? "Enable provider" : "Disable provider"}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ProviderTestResultsView({ results }) {
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
