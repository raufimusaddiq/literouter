import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { vi } from "#test/vi";
import { Database } from "bun:sqlite";
import path from "node:path";
import { startRealServer } from "./helpers/real-server.js";

const signalsDelivered = process.platform !== "win32";
const FLUSH_WINDOW_MS = 600_000;

function usageRows(dataDir) {
  const db = new Database(path.join(dataDir, "db", "data.sqlite"), { readonly: true });
  try {
    return db.query("SELECT COUNT(*) AS n FROM usageHistory").get().n;
  } finally {
    db.close();
  }
}

describe("SIGTERM shutdown", () => {
  let real;
  const state = { rowsBefore: null, exitCode: null };

  beforeAll(async () => {
    if (!signalsDelivered) return;
    real = await startRealServer({ env: { USAGE_FLUSH_INTERVAL_MS: String(FLUSH_WINDOW_MS) } });
    const res = await real.chat("pm/mock-ok");
    expect(res.status).toBe(200);
    await res.json();
    await Bun.sleep(1000);
    state.rowsBefore = usageRows(real.dataDir);
    real.child.kill("SIGTERM");
    state.exitCode = await Promise.race([real.child.exited, Bun.sleep(10_000).then(() => "timeout")]);
  }, 60_000);

  afterAll(async () => {
    await real?.stop();
  });

  it.skipIf(!signalsDelivered)("buffered usage rows are in SQLite after SIGTERM", () => {
    expect(state.rowsBefore).toBe(0);
    expect(usageRows(real.dataDir)).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!signalsDelivered)("process exits 0", () => {
    expect(state.exitCode).toBe(0);
  });
});

describe("installShutdownHandlers", () => {
  it("adds the SIGINT and SIGTERM listeners once per process, however often it runs", async () => {
    const { installShutdownHandlers } = await import("../../src/server/shutdown.js");
    const original = globalThis.__lrShutdownInstalled;
    delete globalThis.__lrShutdownInstalled;
    const once = spyOn(process, "once").mockImplementation(() => process);
    try {
      installShutdownHandlers();
      installShutdownHandlers();
      installShutdownHandlers();
      expect(once.mock.calls.map((call) => call[0])).toEqual(["SIGINT", "SIGTERM"]);
    } finally {
      once.mockRestore();
      if (original === undefined) delete globalThis.__lrShutdownInstalled;
      else globalThis.__lrShutdownInstalled = original;
    }
  });
});

describe("flushAndExit", () => {
  it("closes the open db adapter, which drains the buffers, and exits 0", async () => {
    const { flushAndExit } = await import("../../src/server/shutdown.js");
    const original = globalThis._dbAdapter;
    const exit = spyOn(process, "exit").mockImplementation(() => {});
    const close = vi.fn();
    globalThis._dbAdapter = { instance: { close } };
    try {
      flushAndExit();
      expect(close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
      globalThis._dbAdapter = original;
    }
  });

  it("still exits 0 when closing the adapter throws", async () => {
    const { flushAndExit } = await import("../../src/server/shutdown.js");
    const original = globalThis._dbAdapter;
    const exit = spyOn(process, "exit").mockImplementation(() => {});
    const logged = spyOn(console, "error").mockImplementation(() => {});
    globalThis._dbAdapter = { instance: { close: () => { throw new Error("disk full"); } } };
    try {
      flushAndExit();
      expect(exit).toHaveBeenCalledWith(0);
      expect(logged).toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      logged.mockRestore();
      globalThis._dbAdapter = original;
    }
  });
});
