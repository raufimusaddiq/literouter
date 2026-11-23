"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Card, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { matchesOAuthState } from "@/shared/utils/oauthCallback";

const PROXY_OAUTH_PROVIDERS = new Set(["trae", "windsurf", "zed"]);

const PASTE_TOKEN_PROVIDERS = {
  trae: {
    label: "Cloud-IDE-JWT",
    instructions:
      "Sign in at trae.ai (or solo.trae.ai), open DevTools → Network, copy the Cloud-IDE-JWT token from any request's Authorization header (~14-day lifetime).",
    placeholder: "Paste Cloud-IDE-JWT here...",
    ideName: "Trae",
    ideOptional: true,
  },
  windsurf: {
    label: "Windsurf API key",
    instructions:
      "In the Windsurf/VS Code IDE, run the \"Windsurf: Provide Auth Token\" command, then copy the displayed sk-ws-... key.",
    placeholder: "Paste sk-ws-... key here...",
    ideName: "Windsurf",
    ideOptional: false,
  },
};

export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig }) {
  const [step, setStep] = useState("waiting");
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [authMode, setAuthMode] = useState("browser");
  const [pasteToken, setPasteToken] = useState("");
  const [ideStatus, setIdeStatus] = useState(null);
  const popupRef = useRef(null);
  const pollingAbortRef = useRef(false);
  const openedRef = useRef(false);
  const flowRef = useRef({ proxyStarted: false, proxyProvider: null, stopSent: false });
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  const isOpenRef = useRef(isOpen);
  const startOAuthFlowRef = useRef(null);
  const { copied, copy } = useCopyToClipboard();

  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");
  const callbackProcessedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPlaceholderUrl(`${window.location.origin}/callback?code=...`);
    }
  }, []);


  const exchangeTokens = useCallback(async (code, state) => {
    if (!authData) return;
    try {
      if (provider === "antigravity" && !matchesOAuthState(authData.state, state)) {
        throw new Error("Callback belongs to a different login attempt; use the latest authorization URL");
      }
      if (callbackProcessedRef.current) return;
      callbackProcessedRef.current = true;
      const res = await fetch(`/api/oauth/${provider}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          redirectUri: authData.redirectUri,
          codeVerifier: authData.codeVerifier,
          state,
          ...(authData.systemId ? { systemId: authData.systemId } : {}),
          ...(oauthMeta ? { meta: oauthMeta } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccessRef.current?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData, provider, oauthMeta]);

  const completeXaiManualCode = useCallback(async (code) => {
    if (!authData?.state) return;
    try {
      const res = await fetch("/api/oauth/xai/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state: authData.state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccessRef.current?.();
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [authData]);

  const startPolling = useCallback(async (deviceCode, codeVerifier, interval, extraData, deadlineMs) => {
    pollingAbortRef.current = false;
    setPolling(true);
    const startedAt = Date.now();
    const deadline = startedAt + (Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : 120_000);

    while (Date.now() < deadline) {
      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted");
        setPolling(false);
        return;
      }

      await new Promise((r) => setTimeout(r, interval * 1000));

      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted after sleep");
        setPolling(false);
        return;
      }

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData }),
        });

        const data = await res.json();

        if (data.success) {
          pollingAbortRef.current = true;
          setStep("success");
          setPolling(false);
          onSuccessRef.current?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied") {
          throw new Error(data.errorDescription || data.error);
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
        setPolling(false);
        return;
      }
    }

    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
  }, [provider]);

  const stopOwnedProxy = useCallback(() => {
    const flow = flowRef.current;
    if (flow.proxyStarted && !flow.stopSent && flow.proxyProvider) {
      flow.stopSent = true;
      fetch(`/api/oauth/${flow.proxyProvider}/stop-proxy`).catch(() => {});
    }
  }, []);

  const startProxyFlow = useCallback(async (providerId) => {
    const startRes = await fetch(`/api/oauth/${providerId}/start-proxy`);
    const startData = await startRes.json();
    if (!startRes.ok || !startData.success || !startData.callbackUrl) {
      throw new Error(startData.reason || startData.error || `Failed to start ${providerId} callback server`);
    }
    flowRef.current.proxyStarted = true;
    flowRef.current.proxyProvider = providerId;
    flowRef.current.stopSent = false;
    if (!isOpenRef.current) {
      stopOwnedProxy();
      return;
    }
    const authorizeUrl = new URL(`/api/oauth/${providerId}/authorize`, window.location.origin);
    authorizeUrl.searchParams.set("redirect_uri", startData.callbackUrl);
    const authRes = await fetch(authorizeUrl);
    const authData = await authRes.json();
    if (!authRes.ok) {
      stopOwnedProxy();
      throw new Error(authData.error);
    }
    if (!isOpenRef.current) {
      stopOwnedProxy();
      return;
    }
    const regBody = { state: authData.state };
    if (authData.codeVerifier) regBody.codeVerifier = authData.codeVerifier;
    if (authData.systemId) regBody.systemId = authData.systemId;
    const regRes = await fetch(`/api/oauth/${providerId}/register-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regBody),
    });
    let regData = null;
    try {
      regData = await regRes.json();
    } catch {
      regData = null;
    }
    if (!regRes.ok || regData?.success === false) {
      stopOwnedProxy();
      throw new Error(regData?.error || "Failed to register login session; please retry");
    }
    if (!isOpenRef.current) return;
    setAuthData({ ...authData, proxyProvider: providerId });
    setStep("waiting");
    popupRef.current = window.open(authData.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  }, [stopOwnedProxy]);

  const startOAuthFlow = async () => {
    if (!provider) return;
    try {
      setError(null);
      setAuthData(null);
      setCallbackUrl("");
      callbackProcessedRef.current = false;

      if (PROXY_OAUTH_PROVIDERS.has(provider) && authMode === "browser") {
        await startProxyFlow(provider);
        return;
      }

      const deviceCodeProviders = [
        "github",
        "kiro",
        "kimi",
        "kimi-coding",
        "kilocode",
        "codebuddy-cn",
        "codebuddy-intl",
        "qoder",
        "grok-cli",
      ];
      if (deviceCodeProviders.includes(provider)) {
        setIsDeviceCode(true);
        setStep("waiting");

        const deviceCodeUrl = new URL(`/api/oauth/${provider}/device-code`, window.location.origin);
        if (provider === "kiro" && idcConfig?.startUrl) {
          deviceCodeUrl.searchParams.set("start_url", idcConfig.startUrl);
          if (idcConfig.region) {
            deviceCodeUrl.searchParams.set("region", idcConfig.region);
          }
          deviceCodeUrl.searchParams.set("auth_method", "idc");
        }
        const res = await fetch(deviceCodeUrl.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

        const extraData = provider === "kiro"
          ? {
              _clientId: data._clientId,
              _clientSecret: data._clientSecret,
              _region: data._region,
              _authMethod: data._authMethod,
              _startUrl: data._startUrl,
            }
          : provider === "qoder"
          ? {
              _qoderNonce: data._qoderNonce,
              _qoderMachineId: data._qoderMachineId,
              _qoderVerifier: data.codeVerifier,
            }
          : (provider === "kimi" || provider === "kimi-coding")
          ? { _kimiDeviceId: data._kimiDeviceId }
          : null;
        startPolling(
          data.device_code,
          data.codeVerifier,
          data.interval || 5,
          extraData,
          Number.isFinite(data.expires_in) && data.expires_in > 0
            ? data.expires_in * 1000
            : undefined,
        );
        return;
      }

      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      let redirectUri;
      if (provider === "codex") {
        redirectUri = "http://localhost:1455/auth/callback";
      } else if (provider === "xai") {
        redirectUri = "http://127.0.0.1:56121/callback";
      } else {
        redirectUri = `http://localhost:${appPort}/callback`;
      }

      const authorizeUrl = new URL(`/api/oauth/${provider}/authorize`, window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      if (oauthMeta) {
        Object.entries(oauthMeta).forEach(([k, v]) => { if (v) authorizeUrl.searchParams.set(k, v); });
      }
      const res = await fetch(authorizeUrl.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      redirectUri = data.redirectUri || redirectUri;

      let codexProxyActive = false;
      let codexServerSide = false;
      if (provider === "codex") {
        try {
          const proxyUrl = new URL(`/api/oauth/codex/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          codexProxyActive = proxyData.success;
          codexServerSide = !!proxyData.serverSide;
        } catch {
          codexProxyActive = false;
        }
      }

      let xaiProxyActive = false;
      let xaiServerSide = false;
      if (provider === "xai") {
        try {
          const proxyUrl = new URL(`/api/oauth/xai/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          xaiProxyActive = proxyData.success;
          xaiServerSide = !!proxyData.serverSide;
          if (!xaiProxyActive && proxyData.reason === "port_busy") {
            throw new Error("Port 56121 in use; close the conflicting process and retry");
          }
        } catch (e) {
          if (e?.message) throw e;
          xaiProxyActive = false;
        }
      }

      setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide });

      if ((provider === "codex" && codexProxyActive) || (provider === "xai" && xaiProxyActive)) {
        flowRef.current.proxyStarted = true;
        flowRef.current.proxyProvider = provider;
        flowRef.current.stopSent = false;
      }

      if (!data.authUrl) {
        if (data.flowType === "device_code") {
          throw new Error(
            `Provider ${provider} uses device-code login but is not wired in the OAuth modal device-code list`
          );
        }
        throw new Error("No authorization URL returned from OAuth provider");
      }

      if (provider === "codex" && codexProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (provider === "xai" && xaiProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (new URL(redirectUri).origin !== window.location.origin || provider === "codex" || provider === "xai") {
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      }
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onCloseRef.current = onClose;
    isOpenRef.current = isOpen;
    startOAuthFlowRef.current = startOAuthFlow;
  });

  useEffect(() => {
    if (!isOpen || !provider) return;
    if (openedRef.current) return;
    openedRef.current = true;
    setAuthData(null);
    setCallbackUrl("");
    setError(null);
    setIsDeviceCode(false);
    setDeviceData(null);
    setPolling(false);
    setAuthMode("browser");
    setPasteToken("");
    setIdeStatus(null);
    pollingAbortRef.current = false;
    flowRef.current = { proxyStarted: false, proxyProvider: null, stopSent: false };
    if (PASTE_TOKEN_PROVIDERS[provider]) {
      fetch(`/api/oauth/${provider}/ide-status`)
        .then((r) => r.json())
        .then((data) => setIdeStatus(data))
        .catch(() => setIdeStatus({ installed: false, path: null }));
    }
    startOAuthFlowRef.current();
  }, [isOpen, provider]);

  useEffect(() => {
    if (isOpen) return;
    pollingAbortRef.current = true;
    openedRef.current = false;
    stopOwnedProxy();
    flowRef.current = { proxyStarted: false, proxyProvider: null, stopSent: false };
  }, [isOpen, provider, stopOwnedProxy]);

  useEffect(() => {
    const pollProvider = authData?.codexServerSide
      ? "codex"
      : authData?.xaiServerSide
        ? "xai"
        : authData?.proxyProvider
          ? authData.proxyProvider
          : null;
    if (!pollProvider || !authData?.state) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
          const res = await fetch(`/api/oauth/${pollProvider}/poll-status?state=${encodeURIComponent(authData.state)}`);
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStep("success");
          onSuccessRef.current?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setError(data.error || "Authentication failed");
          setStep("error");
          return;
        }
      } catch {
      }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setError("Authentication timeout");
        setStep("error");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [authData]);

  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false;

    const handleCallback = async (data) => {
      if (callbackProcessedRef.current) return;
      if (!data || (provider === "antigravity" && !matchesOAuthState(authData.state, data.state))) return;

      const { code, token, state, error: callbackError, errorDescription } = data;

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(errorDescription || callbackError);
        setStep("error");
        return;
      }

      if (token || code) {
        await exchangeTokens(token || code, state);
      }
    };

    const handleMessage = (event) => {
      const callbackOrigin = authData.redirectUri ? new URL(authData.redirectUri).origin : window.location.origin;
      if (event.origin !== window.location.origin && event.origin !== callbackOrigin) return;
      
      if (event.data?.type === "oauth_callback") {
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    let channel;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleCallback(event.data);
    } catch (e) {
      console.log("BroadcastChannel not supported");
    }

    const handleStorage = (event) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch (e) {
          console.log("Failed to parse localStorage data");
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) {
        const data = JSON.parse(stored);
        if (data.timestamp && Date.now() - data.timestamp < 30000) {
          handleCallback(data);
        }
        localStorage.removeItem("oauth_callback");
      }
    } catch {
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, exchangeTokens, provider]);

  const handleManualSubmit = async () => {
    try {
      setError(null);

      if (authMode === "paste-token" && PASTE_TOKEN_PROVIDERS[provider]) {
        const token = pasteToken.trim();
        if (!token) throw new Error("Missing token");
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccessRef.current?.();
        return;
      }

      const input = callbackUrl.trim();

      if (PROXY_OAUTH_PROVIDERS.has(provider) && input) {
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: input,
            state: authData?.state,
            ...(authData?.redirectUri ? { redirectUri: authData.redirectUri } : {}),
            ...(authData?.codeVerifier ? { codeVerifier: authData.codeVerifier } : {}),
            ...(authData?.systemId ? { systemId: authData.systemId } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccessRef.current?.();
        return;
      }

      if (input.startsWith("eyJ") && input.includes(".")) {
        await exchangeTokens(input, null);
        return;
      }

      if (provider === "xai" && input && !input.includes("://") && !input.includes("?") && !input.includes("code=")) {
        await completeXaiManualCode(input);
        return;
      }

      if (provider === "kimchi" && input && !input.includes("://") && !input.includes("?")) {
        await exchangeTokens(input, null);
        return;
      }

      const url = new URL(input);
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code && !token) {
        throw new Error(
          provider === "xai"
            ? "Paste the callback URL or copied xAI code"
            : provider === "kimchi"
              ? "No Kimchi token found in URL"
              : "No authorization code found in URL"
        );
      }

      await exchangeTokens(token || code, state);
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  };

  const handleClose = useCallback(() => {
    stopOwnedProxy();
    onCloseRef.current();
  }, [stopOwnedProxy]);

  if (!provider || !providerInfo) return null;
  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = deviceData?.verification_uri_complete || deviceData?.verification_uri || "";
  const modalTitle = isXaiProvider ? "Connect Grok Build OAuth" : `Connect ${providerInfo.name}`;
  const manualPlaceholder = isXaiProvider
    ? "http://127.0.0.1:56121/callback?code=... or copied code"
    : isKimchiProvider
      ? `${placeholderUrl.replace("code=...", "token=...")} or copied token`
      : authData?.redirectUri ? `${authData.redirectUri}?code=...` : placeholderUrl;

  return (
    <Modal isOpen={isOpen} title={modalTitle} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {PROXY_OAUTH_PROVIDERS.has(provider) && (step === "waiting" || step === "input" || step === "error") && (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setAuthMode("browser"); setError(null); setStep("waiting"); startOAuthFlow(); }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${authMode === "browser" ? "border-ink bg-ink text-bg" : "border-line-strong bg-bg text-muted hover:border-ink/40 hover:text-ink"}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">language</span>
                Sign in with browser
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode("paste-token"); setError(null); setStep("input"); }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${authMode === "paste-token" ? "border-ink bg-ink text-bg" : "border-line-strong bg-bg text-muted hover:border-ink/40 hover:text-ink"}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">key</span>
                Paste token
              </button>
            </div>

            {authMode === "browser" && (
              <>
                {step === "waiting" && (
                  <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
                    <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] text-ink">progress_activity</span>
                    <span className="text-sm text-ink">Waiting for browser authorization…</span>
                  </div>
                )}
                {step === "input" && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">
                      Popup was blocked. After authorizing in the browser, paste the full callback URL here:
                    </p>
                    <Input
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      placeholder="http://127.0.0.1:.../callback?..."
                      inputClassName="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>Connect</Button>
                      <Button onClick={handleClose} variant="ghost" fullWidth>Cancel</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {authMode === "paste-token" && (
              <div className="space-y-3">
                {ideStatus && !ideStatus.installed && (
                  <div className={`rounded-md border px-3 py-2 text-sm ${PASTE_TOKEN_PROVIDERS[provider].ideOptional ? "border-line-strong bg-bg text-muted" : "border-warning/40 bg-warning/10 text-warning"}`}>
                    {PASTE_TOKEN_PROVIDERS[provider].ideName} IDE not detected.
                    {PASTE_TOKEN_PROVIDERS[provider].ideOptional
                      ? " You can still grab the token from DevTools."
                      : ` Install ${PASTE_TOKEN_PROVIDERS[provider].ideName} IDE to get the token, or use "Sign in with browser".`}
                  </div>
                )}
                <p className="text-sm text-muted">{PASTE_TOKEN_PROVIDERS[provider].instructions}</p>
                <Input
                  value={pasteToken}
                  onChange={(e) => setPasteToken(e.target.value)}
                  placeholder={PASTE_TOKEN_PROVIDERS[provider].placeholder}
                  inputClassName="font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button onClick={handleManualSubmit} fullWidth disabled={!pasteToken}>Connect</Button>
                  <Button onClick={handleClose} variant="ghost" fullWidth>Cancel</Button>
                </div>
              </div>
            )}
          </>
        )}

        {(step === "waiting" || step === "input") && !isDeviceCode && !PROXY_OAUTH_PROVIDERS.has(provider) && (
          <>
            <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] text-ink">
                progress_activity
              </span>
              <span className="text-sm text-ink">
                {isXaiProvider ? "Waiting for Grok Build OAuth…" : "Waiting for popup authorization…"}
              </span>
            </div>

            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-line" />
              <span className="text-xs text-faint">Or paste callback URL manually</span>
              <div className="h-px flex-1 bg-line" />
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">
                  Step 1: Open this {isXaiProvider ? "Grok Build OAuth URL" : "URL"} in your browser
                </p>
                <div className="flex gap-2">
                  <Input value={authData?.authUrl || ""} readOnly className="flex-1" inputClassName="font-mono text-xs" />
                  <Button variant="secondary" size="lg" icon={copied === "auth_url" ? "check" : "content_copy"} onClick={() => copy(authData?.authUrl, "auth_url")} disabled={!authData?.authUrl} className="whitespace-nowrap">
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-ink">
                  Step 2: Paste the {provider === "xai" ? "callback URL or copied code" : isKimchiProvider ? "callback URL or copied token" : "callback URL"} here
                </p>
                <p className="mb-2 text-xs text-muted">
                  {provider === "xai"
                    ? "If xAI shows a code instead of redirecting, paste that code here."
                    : isKimchiProvider
                      ? "After authorization, copy the full callback URL or token from your browser."
                    : "After authorization, copy the full URL from your browser."}
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={manualPlaceholder}
                  inputClassName="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="space-y-3 py-2 text-center">
              <p className="text-sm text-muted">
                Visit the login URL below and authorize:
              </p>
              <Card variant="raised" padding="sm" className="text-left">
                <p className="mb-1 text-xs text-muted">Login URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all font-mono text-xs text-ink">{deviceLoginUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "login_url" ? "check" : "content_copy"}
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                    aria-label="Copy login URL"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="open_in_new"
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                    className="whitespace-nowrap"
                  >
                    Open
                  </Button>
                </div>
              </Card>
              <Card variant="raised" padding="sm">
                <p className="mb-1 text-xs text-muted">Your Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="font-mono text-2xl font-semibold tracking-wider text-ink">{deviceData.user_code}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.user_code, "user_code")}
                    aria-label="Copy device code"
                  />
                </div>
              </Card>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted">
                <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                Waiting for authorization...
              </div>
            )}
          </>
        )}

        {step === "success" && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-ok/30 bg-ok/10">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-ok">check_circle</span>
            </div>
            <h3 className="mb-1.5 text-base font-semibold text-ink">Connected Successfully!</h3>
            <p className="mb-4 text-sm text-muted">
              Your {providerInfo.name} account has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
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
              <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  oauthMeta: PropTypes.object,
  idcConfig: PropTypes.shape({
    startUrl: PropTypes.string,
    region: PropTypes.string,
  }),
};
