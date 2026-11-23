"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Card, Input } from "@/shared/components";

export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [windowsManual, setWindowsManual] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);
    setWindowsManual(false);

    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        setAccessToken(data.accessToken);
        setMachineId(data.machineId);
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setWindowsManual(true);
      } else {
        setError(data.error || "Could not auto-detect tokens");
      }
    } catch (err) {
      setError("Failed to auto-detect tokens");
    } finally {
      setAutoDetecting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Cursor IDE" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {autoDetecting && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-bg">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-2xl text-ink">
                progress_activity
              </span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Auto-detecting tokens...</h3>
            <p className="text-sm text-muted">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {!autoDetecting && (
          <>
            {autoDetected && (
              <div className="rounded-md border border-ok/30 bg-ok/10 p-3">
                <div className="flex gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-ok">check_circle</span>
                  <p className="text-sm text-ok">
                    Tokens auto-detected from Cursor IDE successfully!
                  </p>
                </div>
              </div>
            )}

            {windowsManual && (
              <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-warning">info</span>
                  <p className="text-sm font-medium text-ink">
                    Could not read Cursor database automatically.
                  </p>
                </div>
                <p className="text-xs text-muted">
                  Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Retry
                </Button>
              </div>
            )}

            {!autoDetected && !windowsManual && !error && (
              <Card variant="raised" padding="xs">
                <div className="flex gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-muted">info</span>
                  <p className="text-sm text-muted">
                    Cursor IDE not detected. Please paste your tokens manually.
                  </p>
                </div>
              </Card>
            )}

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-ink">
                Access Token <span className="text-danger">*</span>
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Access token will be auto-filled..."
                rows={3}
                className="w-full resize-none rounded-md border border-line-strong bg-bg px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
              />
            </div>

            <Input
              label="Machine ID"
              required
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              placeholder="Machine ID will be auto-filled..."
              inputClassName="font-mono"
            />

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
