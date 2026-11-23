import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";

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
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    delete process.env.SQLJS_SAVE_MAX_WAIT_MS;
  });
});

describe("driver init retry", () => {
  it("clears initPromise after a rejected init", async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "t8-drv-")), "fresh");
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const driver = await import("@/lib/db/driver.js");
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => { throw new Error("boom"); });
    let first;
    try { first = await driver.getAdapter().then(() => "ok", (e) => e.message); } finally { spy.mockRestore(); }
    expect(first).toBe("boom");
    const second = await driver.getAdapter();
    expect(second).toBeTruthy();
  });
});

describe("sqljs save retry", () => {
  it("reschedules a save with backoff after persist fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-retry-"));
    const file = path.join(dir, "r.db");
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const a = await createSqlJsAdapter(file);
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk"); });
    a.exec("CREATE TABLE t(i INTEGER)");
    await vi.advanceTimersByTimeAsync(150);
    expect(fs.existsSync(file)).toBe(false);
    rename.mockRestore();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fs.existsSync(file)).toBe(true);
    err.mockRestore();
    vi.useRealTimers();
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
    await repo.flushRequestDetails();
    expect(repo.__buffer__.size()).toBe(3);
    adapter.transaction = origTx;
    expect(await repo.flushRequestDetails()).toBe(true);
    const rows = await repo.getRequestDetails({});
    expect(rows.details.map((d) => d.id).sort()).toEqual(["d2", "d3", "d4"]);
    expect(rows.details[0].pxpipe).toEqual({ a: 1 });
    err.mockRestore();
  });
});
