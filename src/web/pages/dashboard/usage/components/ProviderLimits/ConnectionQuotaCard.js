"use client";

import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import Tooltip from "@/shared/components/Tooltip";
import { Button } from "@/shared/components";
import QuotaTable from "./QuotaTable";
import {
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  getConnectionLabel,
} from "./utils";
import {
  ICON_BUTTON,
  AUTO_PING_SETTINGS_KEYS,
  AUTO_PING_TOOLTIPS,
  kiroMethodLabel,
  getConnectionSecondaryLabel,
  kiroRegion,
  getCodexResetCreditCount,
  providerLabel,
} from "./helpers";

export default function ConnectionQuotaCard({
  conn,
  quota,
  isLoading,
  error,
  resettingLimitId,
  deletingId,
  togglingId,
  quotaVisibility,
  quotaSortMode,
  autoPingMaps,
  copied,
  copy,
  onResetConfirm,
  onViewCodexResetCredits,
  onToggleAutoPing,
  onRefreshProvider,
  onEditConnection,
  onDeleteConnection,
  onToggleConnectionActive,
  onHideQuota,
  onShowQuota,
}) {
  const isInactive = conn.isActive === false;
  const isCodex = conn.provider === "codex";
  const resetCreditCount = getCodexResetCreditCount(quota);
  const isResettingLimit = resettingLimitId === conn.id;
  const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit;
  const rawQuotas = quota?.quotas || [];
  const visibleQuotas = filterQuotasByVisibility(conn.provider, rawQuotas, quotaVisibility);
  const hiddenQuotaRows = getHiddenQuotaRows(conn.provider, rawQuotas, quotaVisibility);
  const kiroStatusDot = isInactive
    ? "bg-faint"
    : conn.testStatus === "active" || conn.testStatus === "success"
      ? "bg-ok"
      : conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable"
        ? "bg-danger"
        : "bg-faint";

  return (
    <Card
      variant="raised"
      padding="none"
      className={`min-w-0 ${isInactive ? "opacity-60" : ""}`}
    >
      <div className="px-3 py-2 border-b border-line">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center overflow-hidden">
              <ProviderIcon
                src={`/providers/${conn.provider}.png`}
                alt={conn.provider}
                size={32}
                className="object-contain"
                fallbackText={
                  conn.provider?.slice(0, 2).toUpperCase() || "PR"
                }
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink truncate">
                {providerLabel(conn.provider)}
              </h2>
              {getConnectionLabel(conn) ? (
                <p className="text-xs text-muted truncate">
                  {getConnectionLabel(conn)}
                </p>
              ) : null}
              {getConnectionSecondaryLabel(conn) ? (
                <p className="text-[11px] text-faint truncate">
                  {getConnectionSecondaryLabel(conn)}
                </p>
              ) : null}
              {conn.provider === "kiro" && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-muted">
                    {kiroMethodLabel(conn)}
                  </span>
                  {kiroRegion(conn) && (
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {kiroRegion(conn)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${kiroStatusDot}`} />
                    {isInactive ? "disabled" : conn.testStatus || "unknown"}
                  </span>
                  {conn.providerSpecificData?.profileArn && (
                    <button
                      type="button"
                      onClick={() => copy(conn.providerSpecificData.profileArn, conn.id)}
                      title={conn.providerSpecificData.profileArn}
                      className="inline-flex max-w-full items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-ink"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[12px]">
                        {copied === conn.id ? "check" : "content_copy"}
                      </span>
                      <code className="truncate font-mono">
                        {conn.providerSpecificData.profileArn}
                      </code>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 max-sm:gap-2 shrink-0">
            {isCodex && (
              <>
                <Tooltip
                  text={
                    resetCreditCount > 0
                      ? `Use one Codex reset credit. Available: ${resetCreditCount}`
                      : "No Codex reset credits available"
                  }
                >
                  <button
                    type="button"
                    onClick={() => onResetConfirm({ connection: conn, resetCreditCount })}
                    disabled={resetCreditCount <= 0 || isLoading || rowBusy}
                    aria-label={
                      resetCreditCount > 0
                        ? `Use one Codex reset credit. ${resetCreditCount} available.`
                        : "No Codex reset credits available"
                    }
                    className={`flex h-8 min-w-10 items-center justify-center gap-1 rounded-md border px-2 font-mono text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line disabled:cursor-not-allowed disabled:opacity-60 ${
                      resetCreditCount > 0
                        ? "border-line-strong text-ink hover:bg-bg"
                        : "border-line text-faint"
                    }`}
                  >
                    <span aria-hidden="true" className={`material-symbols-outlined text-[15px] ${isResettingLimit ? "animate-spin" : ""}`}>
                      {isResettingLimit ? "progress_activity" : "restart_alt"}
                    </span>
                    <span>{resetCreditCount}</span>
                  </button>
                </Tooltip>
                <Tooltip text="View Codex reset credit expiry">
                  <button
                    type="button"
                    onClick={() => onViewCodexResetCredits(conn)}
                    disabled={isLoading || rowBusy}
                    aria-label="View Codex reset credit expiry"
                    className={ICON_BUTTON}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">schedule</span>
                  </button>
                </Tooltip>
              </>
            )}
            {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && (
              <Tooltip text={AUTO_PING_TOOLTIPS[conn.provider]}>
                <button
                  type="button"
                  onClick={() => onToggleAutoPing(conn.id, conn.provider, !(autoPingMaps[conn.provider]?.[conn.id] === true))}
                  aria-label="Toggle auto-ping"
                  className={`${ICON_BUTTON} ${autoPingMaps[conn.provider]?.[conn.id] === true ? "bg-bg text-ink" : ""}`}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">bolt</span>
                </button>
              </Tooltip>
            )}
            <Tooltip text="Refresh quota">
              <button
                type="button"
                onClick={() => onRefreshProvider(conn.id, conn.provider)}
                disabled={isLoading || rowBusy}
                aria-label="Refresh quota"
                className={ICON_BUTTON}
              >
                <span aria-hidden="true"
                  className={`material-symbols-outlined text-[18px] ${isLoading ? "animate-spin" : ""}`}
                >
                  refresh
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Edit connection">
              <button
                type="button"
                onClick={() => onEditConnection(conn)}
                disabled={rowBusy}
                aria-label="Edit connection"
                className={ICON_BUTTON}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  edit
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Delete connection">
              <button
                type="button"
                onClick={() => onDeleteConnection(conn.id)}
                disabled={rowBusy}
                aria-label="Delete connection"
                className="flex size-8 max-sm:size-11 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true"
                  className={`material-symbols-outlined text-[18px] ${deletingId === conn.id ? "animate-pulse" : ""}`}
                >
                  delete
                </span>
              </button>
            </Tooltip>
            <div
              className="inline-flex items-center pl-0.5"
              title={
                (conn.isActive ?? true)
                  ? "Disable connection"
                  : "Enable connection"
              }
            >
              <Toggle
                size="sm"
                checked={conn.isActive ?? true}
                disabled={rowBusy}
                aria-label={`${conn.isActive === false ? "Enable" : "Disable"} connection ${conn.name || conn.id}`}
                onChange={(nextActive) =>
                  onToggleConnectionActive(conn.id, nextActive)
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5">
        {isLoading && !quota ? (
          <div className="text-center py-5 text-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[28px] animate-spin">
              progress_activity
            </span>
          </div>
        ) : error ? (
          <div className="text-center py-5">
            <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-danger">
              error
            </span>
            <p className="mt-1.5 text-xs text-muted">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => onRefreshProvider(conn.id, conn.provider)}
              disabled={rowBusy}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        ) : quota?.message ? (
          <div className="text-center py-5">
            <p className="text-xs text-muted">{quota.message}</p>
          </div>
        ) : (
          <QuotaTable
            quotas={visibleQuotas}
            compact
            sortMode="default"
            showSortLabel={
              conn.provider === "codex" && quotaSortMode !== "default"
            }
            onHideQuota={(quotaRow) => onHideQuota(conn.provider, quotaRow)}
          />
        )}
        {quota?.message && !error && !isLoading && (
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted">
            {quota.message}
          </p>
        )}
        {hiddenQuotaRows.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center gap-1 border-t border-line pt-2 text-[11px] text-muted">
            <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px]">
              visibility_off
            </span>
            <span className="shrink-0">Hidden:</span>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap pb-2">
              {hiddenQuotaRows.map((quotaRow) => (
                <button
                  key={getQuotaVisibilityKey(quotaRow)}
                  type="button"
                  onClick={() => onShowQuota(conn.provider, quotaRow)}
                  className="shrink-0 rounded-md border border-line px-1.5 py-0.5 transition-colors hover:bg-bg hover:text-ink"
                  title="Show this quota row"
                >
                  {quotaRow.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
