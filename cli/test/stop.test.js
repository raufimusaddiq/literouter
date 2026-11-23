import { describe, expect, test } from "bun:test";

const { runStop } = require("../src/cli/commands/stop");
const { isTrackedServerAlive } = require("../src/cli/utils/serverProc");

const CLI_PATH = "/pkg/literouter/cli.js";

function makeDeps({ record = { pid: 100, port: 20128 }, listeners = [100], infos = {} } = {}) {
  const calls = [];
  const logs = [];
  let cleared = 0;
  const gone = new Set();
  return {
    calls,
    logs,
    get cleared() {
      return cleared;
    },
    deps: {
      cliPath: CLI_PATH,
      readServerPid: () => record,
      clearServerPid: () => {
        cleared++;
      },
      getListenerPid: () => listeners.find((pid) => !gone.has(pid)) ?? null,
      isTrackedServerAlive,
      getProcessInfo: async (pid) => infos[pid] ?? null,
      kill: (pid, kind) => {
        calls.push(`${kind}:${pid}`);
        if (kind === "launcher") gone.add(100);
        if (kind === "server") gone.add(pid);
      },
      sleep: async () => {},
      log: (line) => logs.push(line),
    },
  };
}

describe("literouter stop", () => {
  test("reports not running when there is no pidfile", async () => {
    const ctx = makeDeps({ record: null });
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual([]);
    expect(ctx.logs.join("\n")).toMatch(/not running/i);
  });

  test("a stale pidfile is cleared and nothing is killed", async () => {
    const ctx = makeDeps({ listeners: [999] });
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual([]);
    expect(ctx.cleared).toBe(1);
    expect(ctx.logs.join("\n")).toMatch(/not running/i);
  });

  test("never kills a foreign process listening on the port", async () => {
    const ctx = makeDeps({ record: { pid: 100, port: 20128 }, listeners: [4242] });
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual([]);
  });

  test("stops the tracked server, removes the pidfile and exits 0", async () => {
    const ctx = makeDeps();
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual(["server:100"]);
    expect(ctx.cleared).toBe(1);
    expect(ctx.logs.join("\n")).toMatch(/stopped/i);
    expect(ctx.logs.join("\n")).toContain("100");
  });

  test("stops the launcher before the server so it cannot restart it", async () => {
    const ctx = makeDeps({
      record: { pid: 100, port: 20128, launcherPid: 50 },
      infos: { 50: { ppid: 1, cmdline: `/home/u/.bun/bin/bun ${CLI_PATH} --tray` } },
    });
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual(["launcher:50"]);
    expect(ctx.cleared).toBe(1);
  });

  test("leaves a launcher pid that is not our cli alone", async () => {
    const ctx = makeDeps({
      record: { pid: 100, port: 20128, launcherPid: 50 },
      infos: { 50: { ppid: 1, cmdline: "/usr/bin/vim notes.txt" } },
    });
    expect(await runStop(ctx.deps)).toBe(0);
    expect(ctx.calls).toEqual(["server:100"]);
  });

  test("exits 1 when the server keeps listening", async () => {
    const ctx = makeDeps();
    ctx.deps.kill = (pid, kind) => ctx.calls.push(`${kind}:${pid}`);
    expect(await runStop(ctx.deps)).toBe(1);
    expect(ctx.cleared).toBe(0);
    expect(ctx.logs.join("\n")).toMatch(/could not stop/i);
  });

  test("falls back to the default port for a legacy bare-pid file", async () => {
    const seen = [];
    const ctx = makeDeps({ record: { pid: 100, port: null } });
    const original = ctx.deps.getListenerPid;
    ctx.deps.getListenerPid = (port) => {
      seen.push(port);
      return original(port);
    };
    await runStop(ctx.deps);
    expect(seen[0]).toBe(20128);
  });

  test("help documents the stop command", () => {
    const result = Bun.spawnSync([process.execPath, "cli.js", "--help"], {
      cwd: require("node:path").join(import.meta.dir, ".."),
      env: { ...process.env, NINEROUTER_UPDATE_PACKAGE: "" },
    });
    expect(result.stdout.toString()).toMatch(/literouter stop/);
  });
});
