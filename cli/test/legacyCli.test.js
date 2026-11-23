import { describe, expect, test } from "bun:test";

const {
  isLegacyNodeProcess,
  isLegacyLauncher,
  stopLegacyServer,
  takeoverLegacy,
  parseProcessInfo,
  classifyListener,
  parseProcCmdline,
  parseProcStatPpid,
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

const TITLE = "next-server (v16.3.4)";
const POSIX_LAUNCHER = "node /usr/lib/node_modules/9router/cli.js --port 20128 --no-browser";
const FORK_LAUNCHER = "/usr/bin/node --dns-result-order=ipv4first /home/u/.nvm/versions/node/v22/lib/node_modules/9router/cli.js";

describe("classifyListener", () => {
  test("a node command line from the old package is legacy", () => {
    expect(classifyListener({ ppid: 1, cmdline: LEGACY_SERVER }, null)).toBe("legacy");
  });

  test("a renamed next-server child of the old launcher is legacy", () => {
    expect(classifyListener({ ppid: 50, cmdline: TITLE }, { ppid: 1, cmdline: POSIX_LAUNCHER })).toBe("legacy");
    expect(classifyListener({ ppid: 50, cmdline: TITLE }, { ppid: 1, cmdline: FORK_LAUNCHER })).toBe("legacy");
  });

  test("a renamed server whose cwd is inside the 9router package is legacy even when orphaned", () => {
    const info = { ppid: 1, cmdline: TITLE, exe: "/usr/bin/node", cwd: "/usr/lib/node_modules/9router/app" };
    expect(classifyListener(info, { ppid: 0, cmdline: "/sbin/init" })).toBe("legacy");
  });

  test("a renamed server with no proof is only a suspect, never legacy", () => {
    expect(classifyListener({ ppid: 1, cmdline: TITLE }, { ppid: 0, cmdline: "/sbin/init" })).toBe("suspect");
    expect(classifyListener({ ppid: 1, cmdline: TITLE }, null)).toBe("suspect");
  });

  test("a parent launcher alone does not make a non-server child legacy", () => {
    expect(classifyListener({ ppid: 50, cmdline: "python3 -m http.server" }, { ppid: 1, cmdline: POSIX_LAUNCHER })).toBe("other");
  });

  test("unrelated listeners and the new bun server are other", () => {
    expect(classifyListener({ ppid: 1, cmdline: "nginx: master process" }, null)).toBe("other");
    expect(classifyListener({ ppid: 1, cmdline: NEW_SERVER }, null)).toBe("other");
    expect(classifyListener({ ppid: 1, cmdline: "/usr/bin/node /srv/app/server.js", cwd: "/srv/app" }, null)).toBe("other");
    expect(classifyListener(null, null)).toBe("other");
  });
});

describe("linux /proc parsing", () => {
  test("splits NUL separated argv", () => {
    expect(parseProcCmdline("node\0--flag\0/usr/lib/node_modules/9router/cli.js\0")).toBe("node --flag /usr/lib/node_modules/9router/cli.js");
    expect(parseProcCmdline("")).toBe("");
  });

  test("reads the parent pid from /proc/<pid>/stat even when the title has spaces and parens", () => {
    expect(parseProcStatPpid("8096 (next-server (v1) S 8037 8037 8037 0 -1 4194560")).toBe(8037);
    expect(parseProcStatPpid("nonsense")).toBeNull();
  });

  test("parses macos ps output", () => {
    expect(parseProcessInfo("  8037 node /opt/homebrew/lib/node_modules/9router/cli.js\n", "ps")).toEqual({
      ppid: 8037,
      cmdline: "node /opt/homebrew/lib/node_modules/9router/cli.js",
    });
  });
});

describe("stopLegacyServer without a pidfile or with a renamed title", () => {
  const legacyInfos = {
    100: { ppid: 50, cmdline: TITLE },
    50: { ppid: 1, cmdline: POSIX_LAUNCHER },
  };

  test("stops the legacy server found on the requested port when there is no pidfile", async () => {
    const { deps, calls } = makeDeps({ record: null, infos: legacyInfos });
    deps.port = 20128;
    deps.getListenerPid = () => (calls.includes("launcher") ? null : 100);
    const res = await stopLegacyServer(deps);
    expect(calls).toEqual(["launcher"]);
    expect(res).toEqual({ stopped: true, launcherPid: 50, serverPid: 100 });
  });

  test("stops a renamed server named by the pidfile", async () => {
    const { deps, calls } = makeDeps({ infos: legacyInfos });
    deps.getListenerPid = () => (calls.includes("launcher") ? null : 100);
    expect((await stopLegacyServer(deps)).stopped).toBe(true);
    expect(calls).toEqual(["launcher"]);
  });

  test("refuses to kill an unidentifiable next-server and reports ambiguity", async () => {
    const { deps, calls } = makeDeps({
      record: null,
      infos: { 100: { ppid: 1, cmdline: TITLE } },
    });
    deps.port = 20128;
    const res = await stopLegacyServer(deps);
    expect(calls).toEqual([]);
    expect(res).toEqual({ stopped: false, ambiguous: true, pid: 100, port: 20128 });
  });

  test("leaves an unrelated listener alone so the port can move on", async () => {
    const { deps, calls } = makeDeps({ record: null, infos: { 100: { ppid: 1, cmdline: "nginx: master process" } } });
    deps.port = 20128;
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
    expect(calls).toEqual([]);
  });

  test("also checks the requested port when the pidfile port is stale", async () => {
    const { deps, calls } = makeDeps({ record: { pid: 7, port: 3000 }, infos: legacyInfos });
    deps.port = 20128;
    deps.getListenerPid = (p) => (p === 20128 && !calls.includes("launcher") ? 100 : null);
    expect((await stopLegacyServer(deps)).stopped).toBe(true);
  });

  test("takeoverLegacy forwards the requested port to the stop step", async () => {
    let seen;
    await takeoverLegacy({
      port: 20999,
      cliPath: "x",
      host: "h",
      isAutoStartEnabled: () => false,
      enableAutoStart() {},
      stop: async (deps) => {
        seen = deps.port;
        return { stopped: false };
      },
    });
    expect(seen).toBe(20999);
  });
});

describe("stronger legacy proof and unknown listeners", () => {
  test("a node process in a dev checkout named 9router is a suspect, not legacy", () => {
    const info = { ppid: 1, cmdline: "node server.js", exe: "/usr/bin/node", cwd: "/home/u/code/9router" };
    expect(classifyListener(info, { ppid: 0, cmdline: "/sbin/init" })).toBe("suspect");
    expect(classifyListener({ ...info, cmdline: "node /home/u/code/other/index.js", cwd: "/opt/9router" }, null)).toBe("suspect");
  });

  test("a node child of the old launcher is legacy even with a plain command line", () => {
    const info = { ppid: 50, cmdline: "node server.js", exe: "/usr/bin/node", cwd: "/somewhere" };
    expect(classifyListener(info, { ppid: 1, cmdline: POSIX_LAUNCHER })).toBe("legacy");
  });

  test("next-server title plus a 9router cwd is legacy", () => {
    expect(classifyListener({ ppid: 1, cmdline: TITLE, exe: "/usr/bin/node", cwd: "/usr/lib/node_modules/9router/app" }, null)).toBe("legacy");
  });

  test("windows CIM output feeds the classification path", () => {
    const server = parseProcessInfo(`4120|${LEGACY_SERVER}\r\n`);
    const launcher = parseProcessInfo(`1008|${LEGACY_LAUNCHER}\r\n`);
    expect(classifyListener(server, launcher)).toBe("legacy");
    expect(isLegacyLauncher(launcher.cmdline)).toBe(true);
    expect(classifyListener(parseProcessInfo("77|C:\\Windows\\System32\\svchost.exe -k netsvcs\r\n"), null)).toBe("other");
  });

  test("refuses when the port is open but nobody can say who listens", async () => {
    const { deps, calls } = makeDeps({ record: null });
    deps.port = 20128;
    deps.getListenerPid = () => null;
    deps.isPortOpen = async () => true;
    const res = await stopLegacyServer(deps);
    expect(res).toEqual({ stopped: false, ambiguous: true, pid: null, port: 20128 });
    expect(calls).toEqual([]);
  });

  test("a closed port with no listener is simply free", async () => {
    const { deps } = makeDeps({ record: null });
    deps.port = 20128;
    deps.getListenerPid = () => null;
    deps.isPortOpen = async () => false;
    expect(await stopLegacyServer(deps)).toEqual({ stopped: false });
  });
});
