import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { killOnSignal, spawnSmoke, waitForHealth } from "../../scripts/smoke-server.mjs";

const originalTmp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lr-smoke-spawn-"));

afterAll(() => {
  for (const [key, value] of Object.entries(originalTmp)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("spawnSmoke cleanup", () => {
  it("leaves no temp data dir behind when the target does not exist", async () => {
    for (const key of Object.keys(originalTmp)) process.env[key] = sandbox;
    await expect(spawnSmoke(path.join(sandbox, "missing-target"))).rejects.toThrow();
    for (const [key, value] of Object.entries(originalTmp)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    expect(fs.readdirSync(sandbox)).toEqual([]);
  });
});

describe("waitForHealth", () => {
  it("pauses between non-200 answers instead of hammering the server", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        hits += 1;
        return new Response("starting", { status: hits < 4 ? 503 : 200 });
      },
    });
    try {
      const started = Date.now();
      await waitForHealth(`http://127.0.0.1:${server.port}`, { exitCode: null });
      expect(hits).toBe(4);
      expect(Date.now() - started).toBeGreaterThanOrEqual(600);
    } finally {
      server.stop(true);
    }
  });
});

describe("killOnSignal", () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    it(`kills the child and exits on ${signal}`, () => {
      const killed = [];
      const exits = [];
      const dispose = killOnSignal({ kill: () => killed.push(true) }, (code) => exits.push(code));
      try {
        process.emit(signal);
      } finally {
        dispose();
      }
      expect(killed).toEqual([true]);
      expect(exits).toHaveLength(1);
    });
  }

  it("stops listening once disposed", () => {
    const before = process.listenerCount("SIGINT");
    killOnSignal({ kill() {} }, () => {})();
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
