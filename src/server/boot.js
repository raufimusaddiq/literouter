const STEPS = [
  ["api key secret warning", async () => (await import("@/lib/auth/apiKeySecretWarning")).warnIfWeakApiKeySecret()],
  ["console log capture", async () => (await import("@/lib/consoleLogBuffer")).initConsoleLogCapture()],
  ["catalog source", async () => (await import("open-sse/providers/catalogOverride.js")).installCatalogSource()],
  ["model catalog sync", async () => (await import("@/lib/modelCatalog/sync.js")).startModelCatalogSync()],
  ["kenari catalog sync", async () => (await import("@/lib/modelCatalog/kenariSync.js")).startKenariCatalogSync()],
  ["outbound proxy", async () => import("@/lib/network/initOutboundProxy")],
  ["bootstrap services", async () => import("@/shared/services/bootstrap.js")],
];

async function runSteps() {
  for (const [name, step] of STEPS) {
    try {
      await step();
    } catch (error) {
      console.error(`[boot] ${name} failed:`, error);
    }
  }
}

export async function runBootOnce() {
  globalThis.__lrBoot ||= runSteps();
  await globalThis.__lrBoot;
}
