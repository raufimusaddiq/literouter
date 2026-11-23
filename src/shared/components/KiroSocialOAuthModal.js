"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }) {
  const [step, setStep] = useState("loading");
  const [authUrl, setAuthUrl] = useState("");
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  const openedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) openedRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !provider) return;

    const initAuth = async () => {
      try {
        setError(null);
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error);
        }

        setAuthData(data);
        setAuthUrl(data.authUrl);
        setStep("input");

        if (!openedRef.current) {
          openedRef.current = true;
          window.open(data.authUrl, "_blank");
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
      }
    };

    initAuth();
  }, [isOpen, provider]);

  const handleManualSubmit = async () => {
    try {
      setError(null);
      
      let url;
      try {
        url = new URL(callbackUrl);
      } catch (e) {
        throw new Error("Invalid callback URL format");
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code) {
        throw new Error("No authorization code found in URL");
      }

      const res = await fetch("/api/oauth/kiro/social-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          codeVerifier: authData.codeVerifier,
          provider,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal isOpen={isOpen} title={`Connect Kiro via ${providerName}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {step === "loading" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-bg">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-2xl text-ink">
                progress_activity
              </span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Initializing...</h3>
            <p className="text-sm text-muted">
              Setting up {providerName} authentication
            </p>
          </div>
        )}

        {step === "input" && (
          <>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authUrl} readOnly className="flex-1" inputClassName="font-mono text-xs" />
                  <Button
                    variant="secondary"
                    size="lg"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authUrl, "auth_url")}
                    className="whitespace-nowrap"
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-ink">Step 2: Paste the callback URL here</p>
                <p className="mb-2 text-xs text-muted">
                  After authorization, copy the full URL from your browser address bar.
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="kiro://kiro.kiroAgent/authenticate-success?code=..."
                  inputClassName="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === "success" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-ok/30 bg-ok/10">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-ok">check_circle</span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Connected Successfully!</h3>
            <p className="mb-4 text-sm text-muted">
              Your Kiro account via {providerName} has been connected.
            </p>
            <Button onClick={onClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-danger/30 bg-danger/10">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-danger">error</span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Connection Failed</h3>
            <p className="mb-4 text-sm text-danger">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => setStep("input")} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
