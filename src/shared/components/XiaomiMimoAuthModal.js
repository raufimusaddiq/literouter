"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Card } from "@/shared/components";

export default function XiaomiMimoAuthModal({ isOpen, onSuccess, onClose }) {
  const [phase, setPhase] = useState("detecting");
  const [detectResult, setDetectResult] = useState(null);
  const [error, setError] = useState(null);
  const [oauthUrl, setOauthUrl] = useState(null);
  const [oauthState, setOauthState] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      setPhase("detecting");
      setError(null);
      setDetectResult(null);
      setOauthUrl(null);

      try {
        const res = await fetch("/api/oauth/xiaomi-mimo/auto-import");
        const data = await res.json();
        if (cancelled) return;

        if (data.found && data.apiKey) {
          setDetectResult(data);
          setPhase("found");
        } else {
          setPhase("not-found");
          setError(data.error || "Xiaomi MiMo Desktop credentials not found on this machine.");
        }
      } catch {
        if (!cancelled) {
          setPhase("not-found");
          setError("Failed to read local Xiaomi MiMo Desktop credentials.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen]);

  const handleImport = async () => {
    if (!detectResult?.apiKey) return;
    setPhase("importing");
    setError(null);

    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: detectResult.apiKey,
          uid: detectResult.uid,
          baseUrl: detectResult.baseUrl,
          mimoPassToken: detectResult.mimoPassToken || null,
          mimoUserId: detectResult.mimoUserId || null,
          mimoCUserId: detectResult.mimoCUserId || null,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.(data.connection);
      onClose();
    } catch (err) {
      setPhase("found");
      setError(err.message);
    }
  };

  const handleStartOAuth = async () => {
    setError(null);
    try {
      const state = crypto.randomUUID();
      const res = await fetch(`/api/oauth/xiaomi-mimo/authorize?state=${state}`);
      const data = await res.json();
      if (data.authorizeUrl) {
        setOauthUrl(data.authorizeUrl);
        setOauthState(data.state);
        window.open(data.authorizeUrl, "_blank", "width=600,height=700");
      } else {
        throw new Error(data.error || "Failed to start OAuth");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePollOAuth = async () => {
    if (!oauthState) return;
    setError(null);
    try {
      const res = await fetch(`/api/oauth/xiaomi-mimo/poll-status?state=${oauthState}`);
      const data = await res.json();

      if (data.status === "done" && data.result) {
        const exRes = await fetch("/api/oauth/xiaomi-mimo/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: oauthState }),
        });
        const exData = await exRes.json();
        if (exData.success) {
          onSuccess?.(exData.connection);
          onClose();
        } else {
          throw new Error(exData.error || "Exchange failed");
        }
      } else if (data.status === "error") {
        throw new Error(data.error || "OAuth failed");
      } else {
        setError("Authorization not completed yet. Finish in the browser, then click Check Again.");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Xiaomi MiMo" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {phase === "detecting" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-bg">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-2xl text-ink">
                progress_activity
              </span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Reading local credentials...</h3>
            <p className="font-mono text-xs text-muted">
              Checking ~/.local/share/mimocode/auth.json
            </p>
          </div>
        )}

        {phase === "found" && detectResult && (
          <>
            <div className="rounded-md border border-ok/30 bg-ok/10 p-3">
              <div className="flex gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-ok">check_circle</span>
                <div className="text-sm text-ok">
                  <p className="font-medium">Xiaomi MiMo Desktop credentials found!</p>
                  <p className="mt-1 font-mono text-xs opacity-90">
                    UID: {detectResult.uid || "—"} · Source: {detectResult.source?.split(/[\\/]/).pop()}
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleImport} fullWidth>
                Connect with Local Credentials
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {phase === "importing" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-bg">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-2xl text-ink">
                progress_activity
              </span>
            </div>
            <h3 className="text-base font-semibold text-ink">Connecting...</h3>
          </div>
        )}

        {phase === "not-found" && (
          <>
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-warning">info</span>
                <div className="text-sm text-muted">
                  <p className="font-medium text-ink">Local credentials not found</p>
                  <p className="mt-1">{error}</p>
                  <p className="mt-2 text-xs">
                    Make sure Xiaomi MiMo Desktop is installed and you are signed in, then retry.
                    Or sign in via browser below.
                  </p>
                </div>
              </div>
            </div>

            {!oauthUrl ? (
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setPhase("detecting");
                    fetch("/api/oauth/xiaomi-mimo/auto-import")
                      .then((r) => r.json())
                      .then((data) => {
                        if (data.found && data.apiKey) {
                          setDetectResult(data);
                          setPhase("found");
                        } else {
                          setPhase("not-found");
                          setError(data.error || "Still not found.");
                        }
                      })
                      .catch(() => setPhase("not-found"));
                  }}
                  variant="outline"
                  fullWidth
                >
                  Retry Local Detect
                </Button>
                <Button onClick={handleStartOAuth} fullWidth>
                  Sign in via Browser
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Card variant="raised" padding="xs">
                  <p className="text-sm text-muted">
                    Browser opened. Complete the Xiaomi sign-in, then click{" "}
                    <strong className="text-ink">Check Again</strong>.
                  </p>
                </Card>
                <div className="flex gap-2">
                  <Button onClick={handlePollOAuth} fullWidth>
                    Check Again
                  </Button>
                  <Button onClick={onClose} variant="ghost" fullWidth>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

XiaomiMimoAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
