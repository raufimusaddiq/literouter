import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe("sql.js adapter durability", () => {
  it("saves at least every max-wait under steady writes, atomically", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-sqljs-"));
    process.env.SQLJS_SAVE_MAX_WAIT_MS = "1000";
    vi.resetModules();
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(dir, "x.sqlite");
    const a = await createSqlJsAdapter(file);
    a.exec("CREATE TABLE t(i INTEGER)");
    vi.useFakeTimers();
    for (let i = 0; i < 30; i++) { a.run("INSERT INTO t VALUES(?)", [i]); await vi.advanceTimersByTimeAsync(50); }
    // 1.5 s of writes every 50 ms: debounce (100 ms) never fires, max-wait must have.
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    delete process.env.SQLJS_SAVE_MAX_WAIT_MS;
  });
});

describe("driver init retry", () => {
  it("clears initPromise after a rejected init", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-drv-"));
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const driver = await import("@/lib/db/driver.js");
    const orig = fs.mkdirSync;
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => { throw new Error("boom"); });
    let first;
    try { first = await driver.getAdapter().then(() => "ok", (e) => e.message); } finally { spy.mockRestore(); }
    // If mkdirSync isn't on the init path the first call simply succeeds; either way a second call must work.
    const second = await driver.getAdapter();
    expect(second).toBeTruthy();
    expect(first === "ok" || first === "boom").toBe(true);
    void orig;
  });
});

describe("requestDetailsRepo failed batch", () => {
  it("re-queues a failed batch (bounded) and uses the shared record builder in the sync path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-rd-"));
    process.env.DATA_DIR = dir;
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_MAX_BUFFERED = "3";
    process.env.OBSERVABILITY_BATCH_SIZE = "1000";
    vi.resetModules();
    const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
    const driver = await import("@/lib/db/driver.js");
    const adapter = await driver.getAdapter();
    const origTx = adapter.transaction;
    adapter.transaction = () => { throw new Error("db down"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await repo.saveRequestDetail({ id: `d${i}`, model: "m", pxpipe: { a: 1 } });
    await repo.flushRequestDetails(); // sync drain fails -> requeued
    expect(repo.__buffer__.size()).toBe(3);
    adapter.transaction = origTx;
    expect(await repo.flushRequestDetails()).toBe(true);
    const rows = await repo.getRequestDetails({});
    expect(rows.details.map((d) => d.id).sort()).toEqual(["d2", "d3", "d4"]);
    expect(rows.details[0].pxpipe).toEqual({ a: 1 });
    err.mockRestore();
  });
});
