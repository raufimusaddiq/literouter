import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";

afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe("bun:sqlite adapter durability", () => {
  it("checkpoint folds committed writes into the main file a second connection can read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-bun-"));
    process.env.DATA_DIR = dir;
    delete global._dbAdapter;
    vi.resetModules();
    const { Database } = await import("bun:sqlite");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const a = await getAdapter();
    a.exec("CREATE TABLE t(i INTEGER)");
    for (let i = 0; i < 30; i++) a.run("INSERT INTO t VALUES(?)", [i]);
    a.checkpoint();
    const file = path.join(dir, "db", "data.sqlite");
    const reader = new Database(file, { readonly: true });
    expect(reader.query("SELECT COUNT(*) AS n FROM t").get().n).toBe(30);
    reader.close(true);
    expect(fs.readdirSync(path.join(dir, "db")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    a.close();
    delete global._dbAdapter;
    fs.rmSync(dir, { recursive: true, force: true });
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

describe("bun:sqlite close after a failed checkpoint", () => {
  it("still finalizes statements and releases the file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t8-retry-"));
    process.env.DATA_DIR = dir;
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const a = await getAdapter();
    a.exec("CREATE TABLE t(i INTEGER)");
    a.run("INSERT INTO t VALUES(?)", [1]);
    const realExec = a.raw.exec.bind(a.raw);
    const exec = vi.spyOn(a.raw, "exec").mockImplementation((sql) => {
      if (String(sql).includes("wal_checkpoint")) throw new Error("disk");
      return realExec(sql);
    });
    expect(() => a.close()).not.toThrow();
    exec.mockRestore();
    delete global._dbAdapter;
    expect(() => fs.rmSync(dir, { recursive: true })).not.toThrow();
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
