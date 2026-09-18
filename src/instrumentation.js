export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Planned shutdown (docker stop / SIGTERM) must drain the bounded
    // request-details buffer. Bounded so a stalled DB cannot block exit.
    if (!global.__liteRouterFlushHook) {
      global.__liteRouterFlushHook = true;
      const flush = async () => {
        try {
          const { flushRequestDetails } = await import("@/lib/db/index.js");
          await flushRequestDetails(3000);
        } catch {
          /* exiting anyway */
        }
        process.exit(0);
      };
      process.once("SIGTERM", flush);
      process.once("SIGINT", flush);
    }
  }
}
