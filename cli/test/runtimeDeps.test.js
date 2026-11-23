import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { runStop } = require("../src/cli/commands/stop");
const { createRuntimeDeps } = require("../src/cli/utils/runtimeDeps");

describe("production wiring of stop", () => {
  test("cli.js builds the stop and takeover deps from createRuntimeDeps", () => {
    const source = readFileSync(join(import.meta.dir, "..", "cli.js"), "utf8");
    expect(source).toMatch(/runStop\(createRuntimeDeps\(/);
    expect(source).toMatch(/takeoverLegacy\(\{\s*\.\.\.createRuntimeDeps\(/);
  });

  test("the real deps carry every dependency runStop and takeover use", () => {
    const deps = createRuntimeDeps({ cliPath: "x" });
    for (const key of ["readServerPid", "clearServerPid", "getListenerPid", "isPidAlive", "isPortOpen", "isTrackedServerAlive", "getProcessInfo", "kill", "sleep", "log"]) {
      expect(typeof deps[key]).toBe("function");
    }
  });

  test("the real deps keep the pidfile when the listener cannot be found but pid and port are live", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {}, close() {} } });
    try {
      const logs = [];
      let cleared = 0;
      const deps = createRuntimeDeps({
        cliPath: "x",
        readServerPid: () => ({ pid: process.pid, port: server.port }),
        clearServerPid: () => {
          cleared++;
        },
        getListenerPid: () => null,
        log: (line) => logs.push(line),
      });
      expect(await runStop(deps)).toBe(1);
      expect(cleared).toBe(0);
      expect(logs.join("\n")).toMatch(/still running/i);
      expect(logs.join("\n")).not.toMatch(/not running/i);
    } finally {
      server.stop(true);
    }
  });

  test("the real deps still treat a dead pid on a closed port as a stale pidfile", async () => {
    const logs = [];
    let cleared = 0;
    const deps = createRuntimeDeps({
      cliPath: "x",
      readServerPid: () => ({ pid: 2147483000, port: 1 }),
      clearServerPid: () => {
        cleared++;
      },
      getListenerPid: () => null,
      log: (line) => logs.push(line),
    });
    expect(await runStop(deps)).toBe(0);
    expect(cleared).toBe(1);
  });
});
