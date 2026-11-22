import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { redisEnabled, redisPing } from "@/lib/redis.js";

process.setMaxListeners(20);

const STARTUP_DEFER_MS = 3000;

const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
};

export async function initializeApp() {
  try {
    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      g.signalHandlersRegistered = true;
    }

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

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((e) => console.log("[AutoPing] scheduler start failed:", e.message));
  }

  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((e) => console.log("[BackgroundTokenRefresh] scheduler start failed:", e.message));
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

export default initializeApp;
