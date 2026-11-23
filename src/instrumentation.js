export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfWeakApiKeySecret } = await import("@/lib/auth/apiKeySecretWarning");
    warnIfWeakApiKeySecret();

    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    const { startKenariCatalogSync } = await import("@/lib/modelCatalog/kenariSync.js");
    startKenariCatalogSync();

    await import("@/shared/services/bootstrap.js");
  }
}
