"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input, OAuthModal } from "@/shared/components";

import { GITLAB_COM, normalizeGitLabBaseUrl } from "@/shared/utils/gitlabBaseUrl";

function getRedirectUri() {
  if (typeof window === "undefined") return "http://localhost/callback";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/callback`;
}

export default function GitLabAuthModal({ isOpen, providerInfo, onSuccess, onClose }) {
  const [mode, setMode] = useState(null);
  const [baseUrl, setBaseUrl] = useState(GITLAB_COM);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showOAuth, setShowOAuth] = useState(false);
  const [oauthMeta, setOauthMeta] = useState(null);

  const reset = () => {
    setMode(null);
    setBaseUrl(GITLAB_COM);
    setClientId("");
    setClientSecret("");
    setPat("");
    setError(null);
    setLoading(false);
    setShowOAuth(false);
    setOauthMeta(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOAuthStart = () => {
    if (!clientId.trim()) {
      setError("Client ID is required");
      return;
    }
    setError(null);
    setOauthMeta({ baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    setShowOAuth(true);
  };

  const handlePATSubmit = async () => {
    if (!pat.trim()) {
      setError("Personal Access Token is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/gitlab/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      onSuccess?.();
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  if (showOAuth && oauthMeta) {
    return (
      <OAuthModal
        isOpen
        provider="gitlab"
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        onSuccess={() => { onSuccess?.(); handleClose(); }}
        onClose={() => { setShowOAuth(false); setOauthMeta(null); }}
      />
    );
  }

  return (
    <Modal isOpen={isOpen} title="Connect GitLab Duo" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {!mode && (
          <>
            <p className="text-sm text-muted">
              Choose how to authenticate with GitLab Duo:
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("oauth")}
                className="flex flex-col items-start gap-2 rounded-md border border-line-strong bg-bg p-4 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-2xl text-ink">lock_open</span>
                <div>
                  <p className="text-sm font-semibold text-ink">OAuth App</p>
                  <p className="text-xs text-muted">Use a GitLab OAuth application</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("pat")}
                className="flex flex-col items-start gap-2 rounded-md border border-line-strong bg-bg p-4 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-2xl text-ink">key</span>
                <div>
                  <p className="text-sm font-semibold text-ink">Personal Access Token</p>
                  <p className="text-xs text-muted">Use a GitLab PAT with api scope</p>
                </div>
              </button>
            </div>
          </>
        )}

        {mode === "oauth" && (
          <>
            <p className="text-xs text-muted">
              Create an OAuth app at{" "}
              <a href={`${normalizeGitLabBaseUrl(baseUrl)}/-/profile/applications`} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-[3px]">
                GitLab Applications
              </a>{" "}
              with redirect URI{" "}
              <code className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-xs text-ink">{getRedirectUri()}</code>
            </p>
            <Input label="GitLab Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Your OAuth application client ID" />
            <Input label="Client Secret (optional for PKCE)" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Leave empty for public PKCE app" />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handleOAuthStart} fullWidth disabled={!clientId.trim()}>
                Authorize
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </>
        )}

        {mode === "pat" && (
          <>
            <p className="text-xs text-muted">
              Create a PAT at{" "}
              <a href={`${normalizeGitLabBaseUrl(baseUrl)}/-/user_settings/personal_access_tokens`} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-[3px]">
                GitLab Access Tokens
              </a>{" "}
              with scopes: <code className="rounded border border-line bg-bg px-1 py-0.5 font-mono text-xs text-ink">api</code>,{" "}
              <code className="rounded border border-line bg-bg px-1 py-0.5 font-mono text-xs text-ink">read_user</code>, and{" "}
              <code className="rounded border border-line bg-bg px-1 py-0.5 font-mono text-xs text-ink">ai_features</code>.
            </p>
            <Input label="GitLab Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input label="Personal Access Token" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" type="password" />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handlePATSubmit} fullWidth disabled={!pat.trim() || loading} loading={loading}>
                Connect
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

GitLabAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
