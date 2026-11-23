#!/usr/bin/env bun

function compareVersions(a, b) {
  const parse = (v) => {
    const [core, ...pre] = String(v).trim().replace(/^v/, "").split("+")[0].split("-");
    const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre.length ? pre.join("-").split(".") : [] };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    if (A.nums[i] > B.nums[i]) return 1;
    if (A.nums[i] < B.nums[i]) return -1;
  }
  if (!A.pre.length && !B.pre.length) return 0;
  if (!A.pre.length) return 1;
  if (!B.pre.length) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (+x !== +y) return +x > +y ? 1 : -1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

if (typeof Bun === "undefined" || compareVersions(Bun.version, "1.4.4") < 0) {
  console.error("literouter requires Bun >= 1.4.4 (https://bun.sh)");
  process.exit(1);
}

const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");

function waitServerReady(port, { host = "127.0.0.1", timeoutMs = 30000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryConnect = () => {
      const socket = net.connect({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryConnect, intervalMs);
      });
    };
    tryConnect();
  });
}

function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  let currentText = text;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${currentText}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${currentText}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }
    },
    succeed(msg) {
      this.stop();
      console.log(`✅ ${msg}`);
    },
    fail(msg) {
      this.stop();
      console.log(`❌ ${msg}`);
    }
  };
}

const pkg = require("./package.json");
const { buildInstallCmd } = require("./src/cli/utils/update");
const { buildServerSpawn } = require("./src/cli/utils/spawn");
const { takeoverLegacy } = require("./src/cli/utils/legacyCli");
const { createRuntimeDeps, killPid, isPortOpen } = require("./src/cli/utils/runtimeDeps");
const { getListenerPid } = require("./src/cli/utils/listener");
const { createCrashLog } = require("./src/cli/utils/crashLog");
const { ensureRuntime } = require("./hooks/runtime");
const {
  writeServerPid,
  readServerPid,
  clearServerPid,
  isTrackedServerAlive,
  buildTrayArgs,
} = require("./src/cli/utils/serverProc");
const { parseCommand, awaitTrayRuntime } = require("./src/cli/utils/launch");
const args = process.argv.slice(2);
const parsedCommand = parseCommand(args);

if (parsedCommand.command === "stop") {
  const { runStop } = require("./src/cli/commands/stop");
  runStop(createRuntimeDeps({ cliPath: __filename }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err?.message || err}`);
      process.exit(1);
    });
  return;
}

if (parsedCommand.command === "xai" && parsedCommand.rest[0] === "video") {
  const { run } = require("./src/cli/commands/xaiVideo");
  run(parsedCommand.rest.slice(1))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err?.message || err}`);
      process.exit(1);
    });
  return;
}


const APP_NAME = pkg.name;
const UPDATE_PACKAGE = (process.env.NINEROUTER_UPDATE_PACKAGE ?? pkg.name).trim();
const INSTALL_CMD_LATEST = buildInstallCmd(UPDATE_PACKAGE);

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "0.0.0.0";

function getProbeHost() {
  return host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host;
}

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

function getDisplayHost() {
  return host === DEFAULT_HOST ? "localhost" : host;
}
const MAX_PORT_ATTEMPTS = 10;

let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--tray" || args[i] === "-t") {
    trayMode = true;
    process.env.TRAY_MODE = "1";
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
                      (set NINEROUTER_UPDATE_PACKAGE="" to disable the check)
  -h, --help          Show this help message
  -v, --version       Show version

Commands:
  ${APP_NAME} stop    Stop the running LiteRouter server (exit 0 when none is running)
  xai video --prompt "..." --output video.mp4
                      Generate a Grok Imagine video via the running gateway
                      (see: ${APP_NAME} xai video --help)
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(pkg.version);
    process.exit(0);
  }
}

if (skipUpdate && !trayMode && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

const RUNTIME = process.execPath;

async function claimPort() {
  const { isAutoStartEnabled, enableAutoStart } = require("./src/cli/tray/autostart");
  const legacy = await takeoverLegacy({
    ...createRuntimeDeps({ cliPath: __filename }),
    host,
    port,
    isAutoStartEnabled,
    enableAutoStart,
  });
  if (legacy && legacy.ambiguous) {
    const holder = legacy.pid ? `pid ${legacy.pid}` : "a process that could not be identified";
    console.error(`
❌ Port ${legacy.port} is held by ${holder}, which may be an old 9router server. ${APP_NAME} will not start a second server on the same data directory.
   If it is the old 9router server, stop it yourself (quit its tray icon or terminal, then remove the old global 9router package with the package manager you installed it with), then run ${APP_NAME} again.
   To use a different port instead, run ${APP_NAME} --port <n>.`);
    process.exit(1);
  }
  if (legacy && legacy.respawned) {
    console.error(`\n❌ The old 9router launcher keeps restarting its server on port ${port}. Quit the old 9router CLI, then run ${APP_NAME} again.`);
    process.exit(1);
  }
  const record = readServerPid();
  const tracked = parseInt(process.env.NINEROUTER_REUSE_PID, 10) || (record && record.pid);
  const trackedPort = (record && record.port) || port;
  clearServerPid();
  if (tracked && tracked !== process.pid && isTrackedServerAlive(tracked, getListenerPid(trackedPort))) {
    killPid(tracked);
    const deadline = Date.now() + 2000;
    while (getListenerPid(port) !== null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const candidate = port + i;
    if (candidate > 65535) break;
    if (getListenerPid(candidate) === null && !(await isPortOpen(candidate))) {
      port = candidate;
      return;
    }
  }
}


function isRestrictedEnvironment() {
  if (process.env.CODESPACES === "true" || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return "GitHub Codespaces";
  }

  if (fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf8").includes("docker"))) {
    return "Docker";
  }

  return null;
}

function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate || !UPDATE_PACKAGE) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(version);
    };

    fetch(`https://registry.npmjs.org/${encodeURIComponent(UPDATE_PACKAGE)}/latest`, { signal: AbortSignal.timeout(3000) })
      .then((res) => res.json())
      .then((latest) => {
        if (latest.version && compareVersions(latest.version, pkg.version) > 0) done(latest.version);
        else done(null);
      })
      .catch(() => done(null));
  });
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, { windowsHide: true }, (err) => {
    if (err) {
      console.log(`Open browser manually: ${url}`);
    }
  });
}

const appDir = path.join(__dirname, "app");
const serverPath = path.join(appDir, "index.js");

if (!fs.existsSync(serverPath)) {
  console.error("Error: app bundle not found. Run 'bun run build' in cli/ first.");
  process.exit(1);
}

const runtimePromise = ensureRuntime({ silent: true }).catch(() => ({ ok: false }));
const updatePromise = checkForUpdate();
claimPort().then(() => startServer(updatePromise, runtimePromise));

async function showInterfaceMenu(latestVersion) {
  const { selectMenu } = require("./src/cli/utils/input");
  const { clearScreen } = require("./src/cli/utils/display");
  const { isAutoStartEnabled } = require("./src/cli/tray/autostart");
  clearScreen();

  const displayHost = getDisplayHost();

  const serverUrl = `http://${displayHost}:${port}`;

  const subtitle = `🚀 Server: \x1b[32m${serverUrl}\x1b[0m`;

  const menuItems = [];

  if (latestVersion) {
    menuItems.push({ label: `Update to v${latestVersion} (current: v${pkg.version})`, icon: "⬆" });
  }

  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: `${isAutoStartEnabled() ? "Disable" : "Enable"} Auto-start on Boot`, icon: "🔁" },
    { label: "Exit", icon: "🚪" }
  );

  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);

  const offset = latestVersion ? 1 : 0;

  if (latestVersion && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  if (selected === offset + 3) return "autostart";
  return "exit";
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000;

function startServer(updatePromise, runtimePromise) {
  const latestVersionPromise = Promise.resolve(updatePromise);
  const displayHost = getDisplayHost();
  const url = `http://${displayHost}:${port}/dashboard`;
  if (host === DEFAULT_HOST) {
    const lanIp = getLanIp();
    if (lanIp) console.log(`\x1b[33m⚠ Network-exposed: reachable at http://${lanIp}:${port} (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.\x1b[0m`);
  }

  let restartCount = 0;
  let serverStartTime = Date.now();

  let crashLog = createCrashLog();

  function spawnServer() {
    serverStartTime = Date.now();
    crashLog = createCrashLog();
    const [cmd, options] = buildServerSpawn({ runtime: RUNTIME, serverPath, appDir, port, host, showLog });
    let child;
    try {
      child = Bun.spawn(cmd, options);
    } catch (err) {
      console.error("Failed to start server:", err.message);
      return { pid: undefined, exited: Promise.resolve(1) };
    }
    if (!showLog && child.stderr) crashLog.collect(child.stderr);
    if (child.pid) writeServerPid(child.pid, port, process.pid);
    return child;
  }

  let server = spawnServer();

  let isCleaningUp = false;
  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
      try {
        const { killTray } = require("./src/cli/tray/tray");
        killTray();
      } catch (e) { }
      if (server.pid) {
        process.kill(server.pid, "SIGKILL");
      }
      process.kill(-server.pid, "SIGKILL");
    } catch (e) { }
    clearServerPid();
  }

  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    console.error("Fatal error:", err && err.stack ? err.stack : err);
    isShuttingDown = true;
    cleanup();
    process.exit(1);
  });

  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nExiting...");
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });

  function failNotReady() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`\n❌ Server did not become ready on ${getProbeHost()}:${port}.`);
    crashLog.lines().forEach((l) => console.error(l));
    cleanup();
    process.exit(1);
  }

  const initTrayIcon = () => {
    try {
      const { initTray } = require("./src/cli/tray/tray");
      initTray({
        port,
        host,
        onQuit: () => {
          isShuttingDown = true;
          console.log("\n👋 Shutting down from tray...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
        },
        onOpenDashboard: () => openBrowser(url)
      });
    } catch (err) {
    }
  };

  if (trayMode) {
    process.removeAllListeners("SIGHUP");
    process.on("SIGHUP", () => {});

    console.log(`\n🚀 ${pkg.name} v${pkg.version}`);
    console.log(`Server: http://${displayHost}:${port}`);

    waitServerReady(port, { host: getProbeHost() }).then(async (ready) => {
      if (!ready) return failNotReady();
      await awaitTrayRuntime({ runtime: () => runtimePromise, appName: APP_NAME });
      if (isShuttingDown) return;
      initTrayIcon();
      console.log("\n💡 Router is now running in system tray. Close this terminal if you want.");
      console.log("   Right-click tray icon to open dashboard or quit.\n");
    });

    return;
  }

  waitServerReady(port, { host: getProbeHost() }).then(async (ready) => {
    if (!ready) return failNotReady();
    const latestVersion = await latestVersionPromise;
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(latestVersion);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
          console.log(`Run this after exit:\n`);
          console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
          cleanup();
          await new Promise((r) => setTimeout(r, 200));
          process.exit(0);
          return;
        } else if (choice === "web") {
          openBrowser(url);
          const { pause } = require("./src/cli/utils/input");
          await pause("\nPress Enter to go back to menu...");
        } else if (choice === "terminal") {
          const { startTerminalUI } = require("./src/cli/terminalUI");
          await startTerminalUI(port, getProbeHost());
        } else if (choice === "hide") {
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();

          if (process.platform === "darwin") {
            process.removeAllListeners("SIGHUP");
            process.on("SIGHUP", () => {});

            console.log(`\n⏳ Switching to tray mode... (icon already visible in menu bar)`);
            console.log(`🔔 LiteRouter is running in tray (PID: ${process.pid})`);
            console.log(`   Server: http://${displayHost}:${port}`);
            console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

            return;
          }

          console.log(`\n⏳ Starting background process... (tray icon will appear in ~3s)`);

          const bgProcess = Bun.spawn([process.execPath, "--dns-result-order=ipv4first", __filename, ...buildTrayArgs({ host, port })], {
            detached: true,
            stdio: ["ignore", "ignore", "ignore"],
            windowsHide: true,
            env: { ...process.env, NINEROUTER_REUSE_PID: server.pid ? String(server.pid) : "" }
          });
          bgProcess.unref();

          console.log(`🔔 LiteRouter is now running in background (PID: ${bgProcess.pid})`);
          console.log(`   Server: http://${displayHost}:${port}`);
          console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

          cleanup();
          process.exit(0);
        } else if (choice === "autostart") {
          const { enableAutoStart, disableAutoStart, isAutoStartEnabled } = require("./src/cli/tray/autostart");
          const enable = !isAutoStartEnabled();
          if (enable) enableAutoStart(__filename, { host, port });
          else disableAutoStart();
          console.log(enable ? "\n✅ Auto-start enabled for the current host and port.\n" : "\n✅ Auto-start disabled.\n");
          const { pause } = require("./src/cli/utils/input");
          await pause("Press Enter to go back to menu...");
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
        }
      }
    } catch (err) {
      console.error("Error:", err.message);
      cleanup();
      process.exit(1);
    }
  });

  function attachServerEvents() {
    const proc = server;
    proc.exited.then((code) => {
      if (proc !== server) return;
      if (isShuttingDown || code === 0) {
        cleanup();
        process.exit(code || 0);
        return;
      }
      tryRestart(code);
    });
  }

  function tryRestart(code) {
    const aliveMs = Date.now() - serverStartTime;
    if (aliveMs >= RESTART_RESET_MS) restartCount = 0;

    restartCount++;
    if (restartCount > MAX_RESTARTS) {
      console.error(`\n❌ Server crashed ${restartCount} times in a row (code=${code ?? "unknown"}). Giving up.`);
      crashLog.lines().forEach((l) => console.error(l));
      isShuttingDown = true;
      cleanup();
      process.exit(typeof code === "number" && code !== 0 ? code : 1);
      return;
    }
    const delay = Math.min(1000 * 2 ** (restartCount - 1), 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    if (crashLog.lines().length) {
      console.error("\n--- Server crash log ---");
      crashLog.lines().forEach(l => console.error(l));
      console.error("--- End crash log ---\n");
    }

    setTimeout(() => {
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  attachServerEvents();
}
