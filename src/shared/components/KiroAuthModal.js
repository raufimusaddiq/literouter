"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Card, Input } from "@/shared/components";

export default function KiroAuthModal({ isOpen, onMethodSelect, onClose }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [idcStartUrl, setIdcStartUrl] = useState("");
  const [idcRegion, setIdcRegion] = useState("us-east-1");
  const [refreshToken, setRefreshToken] = useState("");
  const [cliProxyJson, setCliProxyJson] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyRegion, setApiKeyRegion] = useState("us-east-1");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [idcCredentials, setIdcCredentials] = useState(null);

  useEffect(() => {
    if (selectedMethod !== "import" || !isOpen) return;

    const autoDetect = async () => {
      setAutoDetecting(true);
      setError(null);
      setAutoDetected(false);
      setIdcCredentials(null);

      try {
        const res = await fetch("/api/oauth/kiro/auto-import");
        const data = await res.json();

        if (data.found) {
          setRefreshToken(data.refreshToken);
          setAutoDetected(true);
          if (data.clientId && data.clientSecret) {
            setIdcCredentials({
              clientId: data.clientId,
              clientSecret: data.clientSecret,
              region: data.region,
              authMethod: data.authMethod,
              profileArn: data.profileArn,
            });
          }
        } else {
          setError(data.error || "Could not auto-detect token");
        }
      } catch (err) {
        setError("Failed to auto-detect token");
      } finally {
        setAutoDetecting(false);
      }
    };

    autoDetect();
  }, [selectedMethod, isOpen]);

  const handleMethodSelect = (method) => {
    setSelectedMethod(method);
    setError(null);
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setError(null);
  };

  const handleImportToken = async () => {
    if (!refreshToken.trim()) {
      setError("Please enter a refresh token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: refreshToken.trim(),
          ...(idcCredentials || {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onMethodSelect("import");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportCliProxyJson = async () => {
    if (!cliProxyJson.trim()) {
      setError("Please paste CLIProxyAPI auth JSON");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import-cli-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: cliProxyJson.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "CLIProxyAPI import failed");
      }

      onMethodSelect("import-cli-proxy");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleIdcContinue = () => {
    if (!idcStartUrl.trim()) {
      setError("Please enter your IDC start URL");
      return;
    }
    onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion });
  };

  const handleApiKeyImport = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          region: apiKeyRegion.trim() || "us-east-1",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onMethodSelect("api-key");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSocialLogin = (provider) => {
    onMethodSelect("social", { provider });
  };

  return (
    <Modal isOpen={isOpen} title="Connect Kiro" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!selectedMethod && (
          <div className="flex flex-col gap-2.5">
            <p className="text-sm text-muted">
              Choose your authentication method:
            </p>

            <button
              type="button"
              onClick={() => onMethodSelect("builder-id")}
              className="w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">shield</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">AWS Builder ID</h3>
                  <p className="text-xs text-muted">
                    Recommended for most users. Free AWS account required.
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("idc")}
              className="w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">business</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">AWS IAM Identity Center</h3>
                  <p className="text-xs text-muted">
                    For enterprise users with custom AWS IAM Identity Center.
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("api-key")}
              className="w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">key</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">API Key</h3>
                  <p className="text-xs text-muted">
                    Use a long-lived Kiro/CodeWhisperer API key (headless auth).
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("social-google")}
              className="hidden w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">account_circle</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">Google Account</h3>
                  <p className="text-xs text-muted">
                    Login with your Google account (manual callback).
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("social-github")}
              className="hidden w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">code</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">GitHub Account</h3>
                  <p className="text-xs text-muted">
                    Login with your GitHub account (manual callback).
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("import")}
              className="w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">file_upload</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">Import Token</h3>
                  <p className="text-xs text-muted">
                    Paste refresh token from Kiro IDE.
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleMethodSelect("import-cli-proxy")}
              className="w-full rounded-md border border-line-strong bg-bg p-3.5 text-left transition-colors hover:border-ink/40 hover:bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-ink">data_object</span>
                <div className="flex-1">
                  <h3 className="mb-0.5 text-sm font-semibold text-ink">Import CLIProxyAPI JSON</h3>
                  <p className="text-xs text-muted">
                    Paste external_idp auth JSON from CLIProxyAPI/Kiro Microsoft login.
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {selectedMethod === "idc" && (
          <div className="space-y-4">
            <Input
              label="IDC Start URL"
              required
              value={idcStartUrl}
              onChange={(e) => setIdcStartUrl(e.target.value)}
              placeholder="https://your-org.awsapps.com/start"
              hint="Your organization's AWS IAM Identity Center URL"
              inputClassName="font-mono"
            />

            <Input
              label="AWS Region"
              value={idcRegion}
              onChange={(e) => setIdcRegion(e.target.value)}
              placeholder="us-east-1"
              hint="AWS region for your Identity Center (default: us-east-1)"
              inputClassName="font-mono"
            />

            {error && (
              <p className="text-sm text-danger">{error}</p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleIdcContinue} fullWidth>
                Continue
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {selectedMethod === "api-key" && (
          <div className="space-y-4">
            <Card variant="raised" padding="xs">
              <div className="flex gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-muted">info</span>
                <p className="text-sm text-muted">
                  Paste a long-lived Kiro/CodeWhisperer API key. It is validated
                  against AWS and stored directly as a bearer credential (no refresh).
                </p>
              </div>
            </Card>

            <Input
              label="API Key"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Kiro API key..."
              inputClassName="font-mono"
            />

            <Input
              label="AWS Region"
              value={apiKeyRegion}
              onChange={(e) => setApiKeyRegion(e.target.value)}
              placeholder="us-east-1"
              hint="AWS region for the key (default: us-east-1)"
              inputClassName="font-mono"
            />

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleApiKeyImport} fullWidth disabled={importing || !apiKey.trim()}>
                {importing ? "Validating..." : "Add API Key"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {selectedMethod === "social-google" && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3.5">
              <div className="flex gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-warning">info</span>
                <div className="flex-1 text-sm">
                  <p className="mb-1 font-medium text-ink">
                    Manual Callback Required
                  </p>
                  <p className="text-muted">
                    After login, you&apos;ll need to copy the callback URL from your browser and paste it back here.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleSocialLogin("google")} fullWidth>
                Continue with Google
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {selectedMethod === "social-github" && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3.5">
              <div className="flex gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-warning">info</span>
                <div className="flex-1 text-sm">
                  <p className="mb-1 font-medium text-ink">
                    Manual Callback Required
                  </p>
                  <p className="text-muted">
                    After login, you&apos;ll need to copy the callback URL from your browser and paste it back here.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleSocialLogin("github")} fullWidth>
                Continue with GitHub
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {selectedMethod === "import" && (
          <div className="space-y-4">
            {autoDetecting && (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-line-strong bg-bg">
                  <span aria-hidden="true" className="material-symbols-outlined animate-spin text-2xl text-ink">
                    progress_activity
                  </span>
                </div>
                <h3 className="mb-1.5 text-base font-semibold text-ink">Auto-detecting token...</h3>
                <p className="text-sm text-muted">
                  Reading from AWS SSO cache
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
                        Token auto-detected from Kiro IDE successfully!
                      </p>
                    </div>
                  </div>
                )}

                {!autoDetected && !error && (
                  <Card variant="raised" padding="xs">
                    <div className="flex gap-2">
                      <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-muted">info</span>
                      <p className="text-sm text-muted">
                        Kiro IDE not detected. Please paste your refresh token manually.
                      </p>
                    </div>
                  </Card>
                )}

                <Input
                  label="Refresh Token"
                  required
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="Token will be auto-filled..."
                  inputClassName="font-mono"
                />

                {error && (
                  <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                    <p className="text-sm text-danger">{error}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleImportToken} fullWidth disabled={importing || !refreshToken.trim()}>
                    {importing ? "Importing..." : "Import Token"}
                  </Button>
                  <Button onClick={handleBack} variant="ghost" fullWidth>
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {selectedMethod === "import-cli-proxy" && (
          <div className="space-y-4">
            <Card variant="raised" padding="xs">
              <div className="flex gap-2">
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-muted">info</span>
                <p className="text-sm text-muted">
                  Paste the Kiro CLIProxyAPI auth JSON containing auth_method=external_idp. Only Microsoft login token endpoints are accepted.
                </p>
              </div>
            </Card>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-ink">
                CLIProxyAPI Auth JSON <span className="text-danger">*</span>
              </label>
              <textarea
                value={cliProxyJson}
                onChange={(e) => setCliProxyJson(e.target.value)}
                placeholder={'{"auth_method":"external_idp","access_token":"...","refresh_token":"...","client_id":"...","token_endpoint":"https://login.microsoftonline.com/.../oauth2/v2.0/token","profile_arn":"...","scopes":"..."}'}
                className="min-h-40 w-full rounded-md border border-line-strong bg-bg p-3 font-mono text-sm text-ink placeholder:text-faint focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line"
              />
            </div>

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleImportCliProxyJson} fullWidth disabled={importing || !cliProxyJson.trim()}>
                {importing ? "Importing..." : "Import CLIProxyAPI JSON"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onMethodSelect: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
