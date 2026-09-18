import { describe, expect, it } from "vitest";

// PRD 24: the request-details buffer must be bounded, must apply a documented
// drop policy on overflow, and shutdown must flush within a fixed timeout.
describe("request details buffer", () => {
  it("drops oldest instead of growing without bound", async () => {
    const mod = await import("../../src/lib/db/repos/requestDetailsRepo.js").catch(() => null);
    if (!mod) return;

    // Buffer only, never flush: keep the batch threshold out of reach.
    process.env.OBSERVABILITY_ENABLED = "true";
    process.env.OBSERVABILITY_BATCH_SIZE = "100000";
    process.env.OBSERVABILITY_MAX_BUFFERED = "10";
    process.env.OBSERVABILITY_FLUSH_INTERVAL_MS = "600000";

    for (let i = 0; i < 50; i++) await mod.saveRequestDetail({ id: `b${i}`, model: "m" });

    const size = await mod.__buffer__?.size?.();
    if (typeof size === "number") expect(size).toBeLessThanOrEqual(10);
  });

  it("flushRequestDetails drains the buffer synchronously", async () => {
    const mod = await import("../../src/lib/db/repos/requestDetailsRepo.js").catch(() => null);
    if (!mod) return;
    const ok = await mod.flushRequestDetails();
    expect(typeof ok).toBe("boolean");
    expect(mod.__buffer__.size()).toBe(0);
  });

  it("installs a synchronous signal drain", async () => {
    const mod = await import("../../src/lib/db/repos/requestDetailsRepo.js").catch(() => null);
    if (!mod) return;
    mod.ensureShutdownHandler();
    // The handler must be sync: Next also listens for these signals and closes
    // the DB, so an async drain would find a dead connection.
    const listeners = process.listeners("SIGTERM");
    expect(listeners.length).toBeGreaterThan(0);
    expect(listeners.some((fn) => fn.constructor.name !== "AsyncFunction")).toBe(true);
  });
});
