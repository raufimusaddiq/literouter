import { describe, expect, it } from "vitest";

describe("request detail signal drain", () => {
  it("persists buffered rows when the process handles SIGTERM", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_BATCH_SIZE = "100000";
    process.env.OBSERVABILITY_FLUSH_INTERVAL_MS = "600000";

    const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
    const driver = await import("@/lib/db/driver.js");
    await driver.getAdapter();
    repo.ensureShutdownHandler();

    await repo.saveRequestDetail({ id: `drain-${Date.now()}`, model: "drain-model", status: "success" });
    expect(repo.__buffer__.size()).toBeGreaterThan(0);

    globalThis.__liteRouterDrainSync();

    const db = driver.getAdapterSync();
    const row = db.get(`SELECT COUNT(*) as c FROM requestDetails WHERE model = 'drain-model'`);
    expect(repo.__buffer__.size()).toBe(0);
    expect(row.c).toBeGreaterThan(0);
  });
});
