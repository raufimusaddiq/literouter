"use client";

import { Modal } from "@/shared/components";
import { getConnectionLabel } from "./utils";
import { formatCreditDate, formatTimeRemaining } from "./helpers";

export default function ResetCreditsModal({ resetCreditsState, onClose }) {
  return (
    <Modal
      isOpen={Boolean(resetCreditsState)}
      onClose={onClose}
      title="Codex Reset Credit Expiry"
      size="full"
    >
      {resetCreditsState && (
        <div className="space-y-3">
          <p className="truncate text-xs text-muted">
            {getConnectionLabel(resetCreditsState.connection) || "Codex account"}
          </p>
          {resetCreditsState.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
              Loading reset credits...
            </div>
          ) : resetCreditsState.error ? (
            <div className="rounded-lg border border-danger px-3 py-2 text-sm text-danger">
              {resetCreditsState.error}
            </div>
          ) : resetCreditsState.data?.credits?.length ? (
            <>
              <div className="flex items-center justify-between border-b border-line pb-2 font-mono text-xs tabular-nums text-muted">
                <span>{resetCreditsState.data.credits.length} reset credit{resetCreditsState.data.credits.length === 1 ? "" : "s"}</span>
                <span>{resetCreditsState.data.availableCount ?? 0} available</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line-strong">
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Granted At</th>
                      <th className="px-3 py-2 font-medium">Expires At</th>
                      <th className="px-3 py-2 font-medium">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resetCreditsState.data.credits.map((credit, index) => (
                      <tr key={`${credit.status}-${credit.expiresAt || index}`} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 text-ink">
                          {credit.status || "unknown"}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-muted">{formatCreditDate(credit.grantedAt)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-ink">{formatCreditDate(credit.expiresAt)}</td>
                        <td className="px-3 py-2 font-mono font-medium tabular-nums text-ink">{formatTimeRemaining(credit.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-muted">
              No reset credit details returned for this account.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
