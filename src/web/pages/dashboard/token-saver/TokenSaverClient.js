"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Badge, Card, Button, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import PageHeader from "@/shared/components/shell/PageHeader";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";

const linkButton = "text-xs text-ink underline underline-offset-[3px] hover:opacity-80";

function SourceLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-normal text-muted underline underline-offset-[3px] hover:text-ink"
    >
      {children}
    </a>
  );
}

function SettingRow({ title, status, description, controls, children }) {
  return (
    <div className="grid items-start gap-x-8 gap-y-3 border-b border-line py-5 last:border-b-0 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {status}
        </div>
        <p className="mt-1 text-[12.5px] text-muted">{description}</p>
      </div>
      {controls && <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">{controls}</div>}
      {children && <div className="min-w-0 sm:col-start-2">{children}</div>}
    </div>
  );
}

function LevelPicker({ levels, value, onChange, description }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {levels.map((lvl) => (
          <button
            key={lvl.id}
            onClick={() => onChange(lvl.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              value === lvl.id
                ? "border-ink bg-ink text-bg"
                : "border-line-strong bg-transparent text-muted hover:bg-raise hover:text-ink"
            }`}
            title={lvl.desc}
          >
            {lvl.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{description}</p>
    </div>
  );
}

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState(3000);
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
  });
  const [pendingExtras, setPendingExtras] = useState([]);
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [removingExtra, setRemovingExtra] = useState(null);
  const [installLog, setInstallLog] = useState("");
  const [extrasConfirm, setExtrasConfirm] = useState(null);
  const [codeAware, setCodeAware] = useState(false);
  const [kompress, setKompress] = useState(true);
  const [restartingProxy, setRestartingProxy] = useState(false);
  const logPollRef = useRef(null);
  const headroomHiddenRef = useRef(false);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [locale, setLocale] = useState("en");

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    if (headroomHiddenRef.current) {
      setHeadroomStatus({ installed: false, running: false, python: null, loading: false });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
      return;
    }
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
      if (!data?.installed) {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
        return;
      }
      try {
        const er = await fetch("/api/headroom/extras", {
          headers: { "Cache-Control": "no-store" },
        });
        if (!er.ok) throw new Error("extras status failed");
        const ed = await er.json();
        setHeadroomExtras((s) => ({
          ...s,
          version: ed.version ?? null,
          extras: ed.extras || { code: false, ml: false },
          available: ed.available || ["code", "ml"],
          loading: false,
        }));
        setPendingExtras([]);
      } catch {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
      }
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const togglePendingExtra = (extra) => {
    setPendingExtras((cur) =>
      cur.includes(extra) ? cur.filter((e) => e !== extra) : [...cur, extra]
    );
  };

  const startLogPolling = useCallback(() => {
    setInstallLog("");
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch("/api/headroom/extras?log=1", {
          headers: { "Cache-Control": "no-store" },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === "string") setInstallLog(d.log);
      } catch {}
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  const installExtrasConfirmed = useCallback(async () => {
    if (pendingExtras.length === 0) return;
    setExtrasActionLoading(true);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: pendingExtras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Install failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
      setPendingExtras([]);
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setExtrasActionLoading(false);
    }
  }, [pendingExtras, startLogPolling, stopLogPolling]);

  const removeExtraConfirmed = useCallback(async (extra) => {
    setRemovingExtra(extra);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: [extra] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setRemovingExtra(null);
    }
  }, [startLogPolling, stopLogPolling]);

  const handleInstallExtras = useCallback(() => {
    if (pendingExtras.length === 0) return;
    if (pendingExtras.includes("ml")) {
      setExtrasConfirm({
        title: "Install [ml]",
        message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
        confirmText: "Install",
        variant: "primary",
        onConfirm: installExtrasConfirmed,
      });
      return;
    }
    installExtrasConfirmed();
  }, [pendingExtras, installExtrasConfirmed]);

  const handleRemoveExtra = useCallback((extra) => {
    setExtrasConfirm({
      title: `Remove [${extra}]`,
      message: `Remove [${extra}] and its packages?`,
      confirmText: "Remove",
      variant: "danger",
      onConfirm: () => removeExtraConfirmed(extra),
    });
  }, [removeExtraConfirmed]);

  const toggleExtraActive = useCallback(async (extra, value) => {
    setExtrasActionError("");
    if (extra === "code") setCodeAware(value);
    if (extra === "ml") setKompress(value);
    const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
    await patchSetting({ [key]: value });
    if (!headroomStatus.running) return;
    setRestartingProxy(true);
    try {
      const res = await fetch("/api/headroom/restart", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restart failed");
      await refreshHeadroomStatus();
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      setRestartingProxy(false);
    }
  }, [headroomStatus.running, refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const handleHeadroomTimeoutBlur = () => {
    const raw = Math.round(Number(headroomTimeoutMs));
    const next = Number.isFinite(raw) && raw > 0 ? raw : 3000;
    setHeadroomTimeoutMs(next);
    patchSetting({ headroomTimeoutMs: next });
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          if (typeof data.headroomTimeoutMs === "number") setHeadroomTimeoutMs(data.headroomTimeoutMs);
          setCodeAware(data.headroomCodeAware === true);
          setKompress(data.headroomKompress !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          headroomHiddenRef.current = data.minimalProfile === true;
          refreshHeadroomStatus();
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus]);

  const headroomRunning = !!headroomStatus.running;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomStatus.localUrl !== false && !headroomStatus.installed
        ? "Not installed"
        : headroomStatus.localUrl !== false
          ? "Stopped"
          : "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Token saver"
        description="Compression layers that cut tokens before a request leaves."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Badge size="sm" variant={rtkEnabled ? "success" : "default"}>RTK {rtkEnabled ? "on" : "off"}</Badge>
            <Badge size="sm" variant={headroomRunning ? "success" : "default"}>Headroom {headroomRunning ? "on" : "off"}</Badge>
            <Badge size="sm" variant={cavemanEnabled ? "success" : "default"}>Caveman {cavemanEnabled ? "on" : "off"}</Badge>
            <Badge size="sm" variant={ponytailEnabled ? "success" : "default"}>Ponytail {ponytailEnabled ? "on" : "off"}</Badge>
          </div>
        }
      />

      <Card id="rtk" padding="none">
        <SettingRow
          title={
            <>
              Compress tool output <SourceLink href="https://github.com/rtk-ai/rtk">(RTK)</SourceLink>
            </>
          }
          description="git/grep/ls/tree/logs → 60-90% fewer input tokens"
          controls={
            <Toggle
              checked={rtkEnabled}
              onChange={() => handleRtkEnabled(!rtkEnabled)}
              aria-label="RETOKEN enabled"
            />
          }
        />
        <SettingRow
          title={
            <>
              Compress context <SourceLink href="https://github.com/chopratejas/headroom">(Headroom)</SourceLink>
            </>
          }
          status={
            <>
              <Badge size="sm" variant={headroomRunning ? "success" : headroomStatus.loading ? "default" : "warning"}>
                {headroomStatusLabel}
              </Badge>
              <button
                type="button"
                onClick={() => setShowHeadroomInstallModal(true)}
                className={linkButton}
              >
                {headroomRunning ? "Manage" : "Setup"}
              </button>
            </>
          }
          description="Compress prompts via /v1/compress before routing to the model"
          controls={
            <Toggle
              checked={headroomEnabled}
              onChange={() => handleHeadroomEnabled(!headroomEnabled)}
              aria-label="Compress context"
            />
          }
        >
          {headroomStatus.installed && (
            <div className="border-l border-line-strong pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">
                  Compression extras
                  {headroomExtras.version ? (
                    <>
                      {" · "}
                      <span className="font-mono tabular-nums">v{headroomExtras.version}</span>
                    </>
                  ) : ""}:
                </span>
                {headroomExtras.available.map((extra) => {
                  const installed = !!headroomExtras.extras[extra];
                  const pending = pendingExtras.includes(extra);
                  const extraTitle =
                    extra === "code"
                      ? "tree-sitter AST compression for code responses"
                      : "Kompress-v2 HF model for prose/agentic traces (~+1GB)";

                  if (installed) {
                    const active = extra === "code" ? codeAware : kompress;
                    return (
                      <div
                        key={extra}
                        className="flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 text-xs text-ink"
                        title={extraTitle}
                      >
                        <Toggle
                          size="sm"
                          checked={active}
                          disabled={restartingProxy}
                          onChange={() => toggleExtraActive(extra, !active)}
                          aria-label={`Enable ${extra} proxy`}
                        />
                        <span className="font-mono font-medium">[{extra}]</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveExtra(extra)}
                          disabled={removingExtra === extra}
                          className="ml-1 text-danger underline underline-offset-[3px] hover:opacity-80 disabled:opacity-50"
                          title={`Uninstall [${extra}]`}
                        >
                          {removingExtra === extra ? "Uninstalling…" : "Uninstall"}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <label
                      key={extra}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                        pending
                          ? "border-ink text-ink"
                          : "border-line-strong text-muted hover:bg-raise hover:text-ink"
                      }`}
                      title={extraTitle}
                    >
                      <input
                        type="checkbox"
                        className="size-3 accent-ink"
                        checked={pending}
                        onChange={() => togglePendingExtra(extra)}
                      />
                      <span className="font-mono font-medium">[{extra}]</span>
                      <span className="text-faint">not installed</span>
                    </label>
                  );
                })}
                {pendingExtras.length > 0 && (
                  <button
                    onClick={handleInstallExtras}
                    disabled={extrasActionLoading}
                    className="rounded-md border border-ink bg-ink px-2.5 py-1 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {extrasActionLoading
                      ? "Installing…"
                      : `Install [proxy,${pendingExtras.join(",")}]`}
                  </button>
                )}
              </div>
              {extrasActionError && (
                <p className="mt-1 text-xs text-danger">{extrasActionError}</p>
              )}
              {restartingProxy && (
                <p className="mt-1 text-xs text-muted">Restarting proxy…</p>
              )}
              {(extrasActionLoading || removingExtra) && installLog && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-raise p-2 font-mono text-[11px] leading-tight text-muted">
                  {installLog}
                </pre>
              )}
              <p className="mt-1 text-xs text-muted">
                Installing adds the package; use <code>on</code>/<code>off</code>{" "}
                to activate it (restarts the proxy). Default install is{" "}
                <code>[proxy]</code> only (SmartCrusher for JSON). Adding{" "}
                <code>[code]</code> enables AST compression
                (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding <code>[ml]</code>{" "}
                enables the Kompress-v2 HF model for prose/agentic traces but
                adds ~1 GB (torch + huggingface-hub).
              </p>
            </div>
          )}
        </SettingRow>
        <SettingRow
          title={
            <>
              Compress LLM output <SourceLink href="https://github.com/JuliusBrussee/caveman">(Caveman)</SourceLink>
            </>
          }
          description="Terse-style system prompt → ~65% fewer output tokens (up to 87%)"
          controls={
            <>
              <Toggle
                checked={cavemanEnabled}
                onChange={() => handleCavemanEnabled(!cavemanEnabled)}
                aria-label="Terse output mode"
              />
              {cavemanEnabled && (
                <LevelPicker
                  levels={visibleCavemanLevels}
                  value={cavemanLevel}
                  onChange={handleCavemanLevel}
                  description={CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)?.desc}
                />
              )}
            </>
          }
        />
        <SettingRow
          title={
            <>
              Lazy senior dev <SourceLink href="https://github.com/DietrichGebert/ponytail">(Ponytail)</SourceLink>
            </>
          }
          description="Bias the model toward minimal code: YAGNI, reuse stdlib, deletion over addition"
          controls={
            <>
              <Toggle
                checked={ponytailEnabled}
                onChange={() => handlePonytailEnabled(!ponytailEnabled)}
                aria-label="Ponytail mode"
              />
              {ponytailEnabled && (
                <LevelPicker
                  levels={PONYTAIL_LEVELS}
                  value={ponytailLevel}
                  onChange={handlePonytailLevel}
                  description={PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)?.desc}
                />
              )}
            </>
          }
        />
      </Card>

      <Modal
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span
              className={headroomRunning ? "text-ok" : headroomStatus.loading ? "text-muted" : "text-warning"}
            >
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-md border border-line-strong px-4 py-2 text-center text-sm text-ink hover:bg-raise"
            >
              Open Headroom Dashboard
            </a>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Proxy URL</p>
            <Input
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              onBlur={handleHeadroomUrlBlur}
              placeholder="http://localhost:8787"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted">
              Use a local proxy for Start/Stop, or an external Docker sidecar
              like http://headroom:8787.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Timeout (ms)</p>
            <Input
              value={String(headroomTimeoutMs)}
              onChange={(e) => setHeadroomTimeoutMs(e.target.value)}
              onBlur={handleHeadroomTimeoutBlur}
              placeholder="3000"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted">
              Request timeout in milliseconds. Defaults to 3000 ms.
            </p>
          </div>
          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className="text-sm text-ok">
              Headroom proxy is reachable. You can enable the token saver.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <p className="text-sm text-muted">
              Start Headroom separately at the configured URL, then recheck.
            </p>
          ) : !headroomStatus.python ? (
            <p className="text-sm text-muted">
              Python ≥ 3.10 required for local managed mode. Install Python
              first, or use an external proxy URL.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Install then click Start:</p>
              <div className="flex items-center gap-2">
                <pre className="flex-1 overflow-x-auto rounded-md border border-line bg-raise p-2 font-mono text-xs text-ink">
                  {`pip install "headroom-ai[proxy]"`}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copy(`pip install "headroom-ai[proxy]"`)
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          {headroomActionError && (
            <p className="text-sm text-danger">{headroomActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!extrasConfirm}
        onClose={() => setExtrasConfirm(null)}
        onConfirm={() => {
          const fn = extrasConfirm?.onConfirm;
          setExtrasConfirm(null);
          fn?.();
        }}
        title={extrasConfirm?.title}
        message={extrasConfirm?.message}
        confirmText={extrasConfirm?.confirmText}
        variant={extrasConfirm?.variant}
      />
    </div>
  );
}
