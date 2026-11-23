"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Card } from "@/shared/components";

export default function IFlowCookieModal({ isOpen, onSuccess, onClose }) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Please paste your cookie");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCookie("");
    setError(null);
    setSuccess(false);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="iFlow Cookie Authentication">
      <div className="space-y-4">
        {success ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-ok/30 bg-ok/10">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-ok">check_circle</span>
            </div>
            <p className="text-base font-semibold text-ink">Authentication Successful!</p>
            <p className="mt-1.5 text-sm text-muted">Fresh API key obtained</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="text-sm text-muted">
                To get a fresh API key, paste your browser cookie from{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-ink underline underline-offset-[3px]"
                >
                  platform.iflow.cn
                </a>
              </p>
              <Card variant="raised" padding="xs" className="space-y-2 text-xs">
                <p className="font-medium text-ink">How to get cookie:</p>
                <ol className="list-inside list-decimal space-y-1 text-muted">
                  <li>Open platform.iflow.cn in your browser</li>
                  <li>Login to your account</li>
                  <li>Open DevTools (F12) → Application/Storage → Cookies</li>
                  <li>Copy the entire cookie string (must include BXAuth)</li>
                  <li>Paste it below</li>
                </ol>
              </Card>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink">
                Cookie String
              </label>
              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="BXAuth=xxx; ..."
                className="w-full resize-none rounded-md border border-line-strong bg-bg px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
                rows={4}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="ghost" onClick={handleClose} disabled={loading} fullWidth>
                Cancel
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                Authenticate
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

IFlowCookieModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
