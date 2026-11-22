export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfWeakApiKeySecret } = await import("@/lib/auth/apiKeySecretWarning");
    warnIfWeakApiKeySecret();

    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Kenari publishes its own limits/modalities/model list; keep a daily copy.
    const { startKenariCatalogSync } = await import("@/lib/modelCatalog/kenariSync.js");
    startKenariCatalogSync();

    // API-only servers never render app/layout.js, so start bootstrap (background
    // token refresh etc.) here. bootstrap.js guards itself with global.__appBootstrapped.
    await import("@/shared/services/bootstrap.js");
  }
}
