import { describe, expect, test } from "bun:test";

const {
  isLegacyNodeProcess,
  isLegacyLauncher,
  stopLegacyServer,
  takeoverLegacy,
  parseProcessInfo,
} = require("../src/cli/utils/legacyCli");
const { isTrackedServerAlive } = require("../src/cli/utils/serverProc");

const LEGACY_SERVER =
  "C:\\Program Files\\nodejs\\node.exe --dns-result-order=ipv4first --max-old-space-size=6144 C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\9router\\app\\custom-server.js";
const LEGACY_LAUNCHER =
  "C:\\Program Files\\nodejs\\node.exe --dns-result-order=ipv4first C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\9router\\cli.js";
const NEW_SERVER = "C:\\Users\\u\\.bun\\bin\\bun.exe --dns-result-order=ipv4first C:\\Users\\u\\.bun\\install\\global\\node_modules\\literouter\\app\\index.js";

function makeDeps({ record = { pid: 100, port: 20128 }, listener = 100, infos = {}, listenerAfterLauncherKill = null } = {}) {
  const calls = [];
  let launcherKilled = false;
  return {
    calls,
    deps: {
      readServerPid: () => record,
      getListenerPid: () => (launcherKilled && listenerAfterLauncherKill !== null ? listenerAfterLauncherKill : listener),
      isTrackedServerAlive,
      getProcessInfo: async (pid) => infos[pid] ?? null,
      kill: (pid) => {
        calls.push(pid === 100 ? "server" : "launcher");
        if (pid !== 100) launcherKilled = true;
      },
      sleep: async () => {},
      log: () => {},
    },
  };
}

describe("legacy node cli detection", () => {
  test("recognizes the old node server command line", () => {
    expect(isLegacyNodeProcess(LEGACY_SERVER)).toBe(true);
    expect(isLegacyNodeProcess("/usr/bin/node /home/u/.nvm/lib/node_modules/9router/app/server.js")).toBe(true);
  });

  test("does not treat a bun literouter server as legacy", () => {
    expect(isLegacyNodeProcess(NEW_SERVER)).toBe(false);
  });

  test("does not treat an unrelated node process as legacy", () => {
    expect(isLegacyNodeProcess("C:\\Program Files\\nodejs\\node.exe C:\\proj\\server.js")).toBe(false);
    expect(isLegacyNodeProcess("node /srv/other/cli.js")).toBe(false);
  });

  test("tells the launcher apart from the server", () => {
    expect(isLegacyLauncher(LEGACY_LAUNCHER)).toBe(true);
    expect(isLegacyLauncher(LEGACY_SERVER)).toBe(false);
  });

  test("parses process info from powershell and ps output", () => {
    expect(parseProcessInfo("55|node.exe server.js\r\n")).toEqual({ ppid: 55, cmdline: "node.exe server.js" });
    expect(parseProcessInfo("  55 node server.js\n", "ps")).toEqual({ ppid: 55, cmdline: "node server.js" });
    expect(parseProcessInfo("")).toBeNull();
  });
});

describe("stopLegacyServer", () => {
  test("kills the legacy launcher before its server", async () => {
    const { deps, calls } = makeDeps({
      infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER }, 50: { ppid: 1, cmdline: LEGACY_LAUNCHER } },
    });
    const res = await stopLegacyServer(deps);
    expect(calls).toEqual(["launcher", "server"]);
    expect(res).toEqual({ stopped: true, launcherPid: 50, serverPid: 100 });
  });

  test("does not kill the server again once it left with the launcher", async () => {
    const { deps, calls } = makeDeps({
      listenerAfterLauncherKill: null,
      infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER }, 50: { ppid: 1, cmdline: LEGACY_LAUNCHER } },
    });
    deps.getListenerPid = () => (calls.includes("launcher") ? null : 100);
    const res = await stopLegacyServer(deps);
    expect(calls).toEqual(["launcher"]);
    expect(res.stopped).toBe(true);
  });

  test("kills only the server when its parent is not the launcher", async () => {
    const { deps, calls } = makeDeps({
      infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER }, 50: { ppid: 1, cmdline: "explorer.exe" } },
    });
    const res = await stopLegacyServer(deps);
    expect(calls).toEqual(["server"]);
    expect(res).toEqual({ stopped: true, launcherPid: undefined, serverPid: 100 });
  });

  test("warns and reports respawned when the server comes back after an unrecognised parent", async () => {
    const { deps, calls } = makeDeps({
      infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER }, 50: { ppid: 1, cmdline: "explorer.exe" } },
    });
    const logs = [];
    deps.log = (line) => logs.push(line);
    let polls = 0;
    deps.getListenerPid = () => {
      if (!calls.includes("server")) return 100;
      return ++polls > 3 ? 300 : null;
    };
    const res = await stopLegacyServer(deps);
    expect(res).toEqual({ stopped: false, respawned: true });
    expect(logs.join("\n")).toMatch(/300/);
    expect(logs.join("\n")).toMatch(/9router/);
    expect(logs.join("\n")).toMatch(/still running/i);
  });

  test("also checks for a respawn when the parent lookup fails", async () => {
    const { deps, calls } = makeDeps({ infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER } } });
    deps.getListenerPid = () => (calls.includes("server") ? 300 : 100);
    deps.log = () => {};
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false, respawned: true });
  });

  test("reports stopped when nothing listens again after the server was killed", async () => {
    const { deps, calls } = makeDeps({
      infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER }, 50: { ppid: 1, cmdline: "explorer.exe" } },
    });
    deps.getListenerPid = () => (calls.includes("server") ? null : 100);
    expect(await stopLegacyServer(deps)).toEqual({ stopped: true, launcherPid: undefined, serverPid: 100 });
  });

  test("skips the process lookup when the pidfile names a launcher (a new CLI wrote it)", async () => {
    const { deps, calls } = makeDeps({ record: { pid: 100, port: 20128, launcherPid: 50 } });
    let lookups = 0;
    deps.getProcessInfo = async () => {
      lookups++;
      return null;
    };
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
    expect(lookups).toBe(0);
    expect(calls).toEqual([]);
  });

  test("leaves a new-CLI server to the normal claimPort path", async () => {
    const { deps, calls } = makeDeps({ infos: { 100: { ppid: 50, cmdline: NEW_SERVER } } });
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
    expect(calls).toEqual([]);
  });

  test("ignores a stale pidfile", async () => {
    const { deps, calls } = makeDeps({ listener: 999, infos: { 100: { ppid: 50, cmdline: LEGACY_SERVER } } });
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
    expect(calls).toEqual([]);
  });

  test("does nothing without a pidfile", async () => {
    const { deps, calls } = makeDeps({ record: null });
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
    expect(calls).toEqual([]);
  });
});

describe("takeoverLegacy", () => {
  test("refreshes autostart only when something was stopped", async () => {
    const enableCalls = [];
    const base = {
      cliPath: "/pkg/cli.js",
      host: "0.0.0.0",
      port: 20128,
      isAutoStartEnabled: () => true,
      enableAutoStart: (...args) => enableCalls.push(args),
    };

    await takeoverLegacy({ ...base, stop: async () => ({ stopped: false }) });
    expect(enableCalls).toHaveLength(0);

    await takeoverLegacy({ ...base, isAutoStartEnabled: () => false, stop: async () => ({ stopped: true }) });
    expect(enableCalls).toHaveLength(0);

    const res = await takeoverLegacy({ ...base, stop: async () => ({ stopped: true, serverPid: 100 }) });
    expect(enableCalls).toEqual([["/pkg/cli.js", { host: "0.0.0.0", port: 20128 }]]);
    expect(res.stopped).toBe(true);
  });
});

describe("takeoverLegacy respawn", () => {
  test("does not refresh autostart when the old server respawned", async () => {
    const enableCalls = [];
    const res = await takeoverLegacy({
      cliPath: "/pkg/cli.js",
      host: "0.0.0.0",
      port: 20128,
      isAutoStartEnabled: () => true,
      enableAutoStart: (...args) => enableCalls.push(args),
      stop: async () => ({ stopped: false, respawned: true }),
    });
    expect(enableCalls).toHaveLength(0);
    expect(res.respawned).toBe(true);
  });
});
