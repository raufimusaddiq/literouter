import { drainRuntimeBuffersSync } from "../lib/db/shutdown.js";

const SIGNALS = ["SIGINT", "SIGTERM"];

export function flushAndExit() {
  try {
    const adapter = globalThis._dbAdapter?.instance;
    if (adapter) adapter.close();
    else drainRuntimeBuffersSync();
  } catch (error) {
    console.error("[shutdown] flush failed:", error);
  }
  process.exit(0);
}

export function installShutdownHandlers() {
  if (globalThis.__lrShutdownInstalled) return;
  globalThis.__lrShutdownInstalled = true;
  for (const signal of SIGNALS) process.once(signal, flushAndExit);
}
