import os from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { cleanupProviderConnections, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import { redisEnabled, redisPing } from "@/lib/redis.js";

// Non-retained subsystem modules are loaded lazily so the minimal profile does
// not pull tunnel/MITM/MCP code into the server boot path at all.
const MINIMAL = process.env.MINIMAL_PROFILE === "true";
const tunnel = () => import("@/lib/tunnel");
const mitm = () => import("@/mitm/manager");

// Cached module handles. Kept separate from the import promise so synchronous
// call sites (signal cleanup) can use them once startup has resolved them.
const g0 = (global.__initAppModules ??= { tunnel: null, mitm: null, bridges: null, mitmAlias: null });

async function loadTunnelModule() {
  if (!g0.tunnel) g0.tunnel = await tunnel();
  return g0.tunnel;
}

async function loadMitmModule() {
  if (!g0.mitm) g0.mitm = await mitm();
  return g0.mitm;
}

// Inject correct paths and DB hooks into manager.js (CJS) from ESM context
(function bootstrapMitm() {
  if (MINIMAL) return;
  if (!process.env.MITM_SERVER_PATH) {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      const appSrc = dirname(dirname(thisFile));
      const candidate = join(appSrc, "mitm", "server.js");
      if (existsSync(candidate)) process.env.MITM_SERVER_PATH = candidate;
    } catch { /* ignore */ }
  }
  try { mitm().then((m) => m.initDbHooks(getSettings, updateSettings)).catch(() => {}); } catch { /* ignore */ }
})();

process.setMaxListeners(20);

// Defer heavy startup work so the first HTTP request (login → dashboard) isn't
// starved by DB cleanup, cloudflared download, lsof/DNS probes and OAuth pings.
const STARTUP_DEFER_MS = 3000;

// Survive Next.js hot reload
const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
  lastOnline: null,
  mitmStartInProgress: false,
  tunnelAutoResumed: false,
  tailscaleAutoResumed: false,
};

export async function initializeApp() {
  try {
    // Register cleanup + exit-respawn callback immediately so signals and
    // unexpected cloudflared exits are handled even during the deferred window.
    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try { g0.mitm?.removeAllDNSEntriesSync(); } catch { /* best effort */ }
        try { g0.bridges?.killAllBridges(); } catch { /* best effort */ }
        try { g0.tunnel?.killCloudflared(); } catch { /* best effort */ }
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      process.on("exit", () => { try { g0.mitm?.removeAllDNSEntriesSync(); } catch { /* ignore */ } });
      g.signalHandlersRegistered = true;
    }

    if (!MINIMAL) {
      loadTunnelModule().then((t) => {
        t.setTunnelUnexpectedExitCallback(() => {
          safeRestartTunnel("unexpected-exit").catch(() => {});
        });
      }).catch(() => {});
    }

    // Defer the heavy work — nothing here blocks incoming requests.
    setTimeout(() => {
      runHeavyStartup().catch((e) => console.error("[InitApp] deferred startup failed:", e.message));
    }, STARTUP_DEFER_MS);
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup() {
  if (redisEnabled()) redisPing().then((ok) => console.log(`[Redis] ${ok ? "connected" : "fallback mode"}`));
  await cleanupProviderConnections();
  const settings = await getSettings();

  // Minimal profile: exposure (tunnel/tailscale) and MITM are not retained
  // product surfaces, so their managers must not initialize at startup. Rollback
  // is a config flip. The modules stay importable for the routes that use them.
  if (process.env.MINIMAL_PROFILE === "true") {
    console.log("[InitApp] minimal profile: skipping tunnel/tailscale/MITM startup");
    if (hasQuotaAutoPingEnabled(settings)) {
      import("@/shared/services/quotaAutoPing")
        .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
        .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
    }
    import("@/sse/services/backgroundTokenRefresh.js")
      .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
      .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));
    return;
  }

  const tunnelApi = await loadTunnelModule();

  // Auto-resume tunnel (once per process)
  if (settings.tunnelEnabled && !g.tunnelAutoResumed) {
    g.tunnelAutoResumed = true;
    console.log("[InitApp] Tunnel was enabled, auto-resuming...");
    safeRestartTunnel("startup").catch((e) => console.log("[InitApp] Tunnel resume failed:", e.message));
  }

  // Auto-resume tailscale (once per process)
  if (settings.tailscaleEnabled && !g.tailscaleAutoResumed) {
    g.tailscaleAutoResumed = true;
    console.log("[InitApp] Tailscale was enabled, auto-resuming...");
    safeRestartTailscale("startup").catch((e) => console.log("[InitApp] Tailscale resume failed:", e.message));
  }

  if (settings.tunnelEnabled) tunnelApi.ensureCloudflared().catch(() => {});

  if (settings.mitmEnabled) {
    autoStartMitm(settings);
  }

  if (!g0.bridges) import("@/lib/mcp/stdioSseBridge").then((m) => { g0.bridges = m; }).catch(() => {});

  configureTunnelMonitoring(settings);

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }

  // Proactive OAuth token refresh (e.g. grok-cli ~6h TTL). Module is idempotent
  // and also started from custom-server.js when that entry is used.
  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

async function autoStartMitm(settings) {
  if (g.mitmStartInProgress) return;
  g.mitmStartInProgress = true;
  try {
    if (!settings.mitmEnabled) return;
    const mitmApi = await loadMitmModule();
    const mitmStatus = await mitmApi.getMitmStatus();
    if (mitmStatus.running) return;

    const password = await mitmApi.loadEncryptedPassword();
    if (!password && process.platform !== "win32") {
      console.log("[InitApp] MITM was enabled but no saved password found, skipping auto-start");
      return;
    }

    const keys = await getApiKeys();
    const activeKey = keys.find(k => k.isActive !== false);

    console.log("[InitApp] MITM was enabled, auto-starting...");
    await mitmApi.startMitm(activeKey?.key || "sk_9router", password);
    console.log("[InitApp] MITM auto-started");
    try {
      await mitmApi.restoreToolDNS(password);
      console.log("[InitApp] DNS restored from saved state");
    } catch (e) {
      console.log("[InitApp] DNS restore failed:", e.message);
    }
  } catch (err) {
    console.log("[InitApp] MITM auto-start failed:", err.message);
  } finally {
    g.mitmStartInProgress = false;
  }
}

// Cooldown only applies to repeating watchdog ticks (anti hammer-loop).
// Network/exit events are one-shot transitions → bypass to recover fast.
const FORCE_RESTART_REASONS = /^(startup|netchange|sleep|sleep\+netchange|online|unexpected-exit)$/;

// ─── Safe restart (4 guards: spawn / cooldown / alive / internet) ────────────

async function safeRestartTunnel(reason) {
  const t = await loadTunnelModule();
  const svc = t.getTunnelService();
  const settings = await getSettings();
  if (!settings.tunnelEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  const force = FORCE_RESTART_REASONS.test(reason);

  // Process alive = trust cloudflared (self-reconnects via --retries 99, keeps same URL).
  // Killing a live process on network change drops the tunnel and rotates the quick-tunnel URL.
  if (t.isCloudflaredRunning()) return;

  if (!force && Date.now() - svc.lastRestartAt < t.RESTART_COOLDOWN_MS) {
    console.log(`[Tunnel] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await t.checkInternet()) return;

  console.log(`[Tunnel] safeRestart (${reason}) — tunnel unreachable${force ? " [force]" : ""}`);
  try {
    await t.enableTunnel();
    svc.lastRestartAt = Date.now();
    console.log("[Tunnel] restart success");
  } catch (err) {
    if (!/cloudflared killed|tunnel cancelled/.test(err.message)) {
      console.log("[Tunnel] restart failed:", err.message);
    }
  }
}

async function safeRestartTailscale(reason) {
  const t = await loadTunnelModule();
  const svc = t.getTailscaleService();
  const settings = await getSettings();
  if (!settings.tailscaleEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;

  // Tailscale daemon is OS-level with built-in reconnect; trust it when running (even on netchange).
  // Startup uses strict probe — cached state is cold after process/dev reload.
  const running = reason === "startup" ? await t.isTailscaleRunningStrict() : t.isTailscaleRunning();
  if (running) return;

  // Daemon alive but funnel dropped → recover funnel only; never full-restart (preserves login/daemon).
  if (t.isDaemonAlive() && svc.activeLocalPort) {
    try {
      await t.startFunnel(svc.activeLocalPort);
      svc.lastRestartAt = Date.now();
      console.log("[Tailscale] funnel re-established (daemon alive)");
    } catch (err) {
      console.log("[Tailscale] funnel recovery failed:", err.message);
    }
    return;
  }

  const force = FORCE_RESTART_REASONS.test(reason);
  if (!force && Date.now() - svc.lastRestartAt < t.RESTART_COOLDOWN_MS) {
    console.log(`[Tailscale] degraded but cooldown active, skip (${reason})`);
    return;
  }
  if (!await t.checkInternet()) return;

  console.log(`[Tailscale] safeRestart (${reason}) — daemon not running${force ? " [force]" : ""}`);
  try {
    await t.enableTailscale();
    svc.lastRestartAt = Date.now();
    console.log("[Tailscale] restart success");
  } catch (err) {
    console.log("[Tailscale] restart failed:", err.message);
  }
}

// ─── Watchdog: 60s tick check both services ──────────────────────────────────

async function startWatchdog() {
  if (g.watchdogInterval) return;
  const t = await loadTunnelModule();
  g.watchdogInterval = setInterval(() => {
    safeRestartTunnel("watchdog").catch(() => {});
    safeRestartTailscale("watchdog").catch(() => {});
  }, t.WATCHDOG_INTERVAL_MS);
  if (g.watchdogInterval.unref) g.watchdogInterval.unref();
}

function stopWatchdog() {
  if (!g.watchdogInterval) return;
  clearInterval(g.watchdogInterval);
  g.watchdogInterval = null;
}

// ─── Network monitor: detect IPv4 fingerprint change + sleep/wake ────────────

async function getNetworkFingerprint() {
  const t = await loadTunnelModule();
  const interfaces = os.networkInterfaces();
  const active = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    if (t.VIRTUAL_IFACE_REGEX.test(name)) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

async function startNetworkMonitor() {
  if (g.networkMonitorInterval) return;
  const t = await loadTunnelModule();

  g.lastNetworkFingerprint = await getNetworkFingerprint();
  g.lastWatchdogTick = Date.now();
  g.lastOnline = null;

  g.networkMonitorInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - g.lastWatchdogTick;
      g.lastWatchdogTick = now;

      const currentFingerprint = await getNetworkFingerprint();
      const networkChanged = currentFingerprint !== g.lastNetworkFingerprint;
      const wasSleep = elapsed > t.NETWORK_CHECK_INTERVAL_MS * 6;
      if (networkChanged) g.lastNetworkFingerprint = currentFingerprint;

      // Real reachability check (TCP 1.1.1.1:443) — not just interface presence
      const online = await t.checkInternet();
      const wasOffline = g.lastOnline === false;
      g.lastOnline = online;

      if (!online) return; // no internet → idle, don't restart

      const onlineEdge = wasOffline; // offline → online transition
      if (!networkChanged && !wasSleep && !onlineEdge) return;

      // Wait for DHCP/DNS to settle before probing
      await new Promise((r) => setTimeout(r, t.NETWORK_SETTLE_MS));

      const reason = onlineEdge ? "online"
        : wasSleep && networkChanged ? "sleep+netchange"
        : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(reason).catch(() => {});
      safeRestartTailscale(reason).catch(() => {});
    } catch (err) {
      console.log("[NetworkMonitor] error:", err.message);
    }
  }, t.NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}


function stopNetworkMonitor() {
  if (!g.networkMonitorInterval) return;
  clearInterval(g.networkMonitorInterval);
  g.networkMonitorInterval = null;
  g.lastNetworkFingerprint = null;
  g.lastOnline = null;
}

export function configureTunnelMonitoring(settings) {
  if (settings?.tunnelEnabled || settings?.tailscaleEnabled) {
    startWatchdog().catch(() => {});
    startNetworkMonitor().catch(() => {});
    return;
  }
  stopWatchdog();
  stopNetworkMonitor();
}

export default initializeApp;
