export function drainRuntimeBuffersSync() {
  const drains = [
    ["usage", globalThis.__liteRouterUsageDrainSync],
    ["request-details", globalThis.__liteRouterDrainSync],
    ["thought-signatures", globalThis.__liteRouterSignatureDrainSync],
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
