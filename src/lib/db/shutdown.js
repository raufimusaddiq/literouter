// Shared synchronous shutdown drain for every DB adapter.
//
// Usage and request-detail buffering intentionally sit off the request path.
// Every adapter must flush those accepted events before closing/persisting the
// underlying database, otherwise fallback runtimes can lose the tail of Usage
// history during SIGTERM/beforeExit.
export function drainRuntimeBuffersSync() {
  const drains = [
    ["usage", globalThis.__liteRouterUsageDrainSync],
    ["request-details", globalThis.__liteRouterDrainSync],
  ];

  let ok = true;
  for (const [name, drain] of drains) {
    if (typeof drain !== "function") continue;
    try {
      drain();
    } catch (error) {
      ok = false;
      console.error(`[DB] failed to drain ${name} buffer during shutdown:`, error);
    }
  }
  return ok;
}
