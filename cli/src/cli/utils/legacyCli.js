const NODE_EXEC = /(^|[\\/\s"'])node(\.exe)?["']?(\s|$)/i;
const LEGACY_DIR = /[\\/]9router[\\/]/i;
const LEGACY_SCRIPT = /(custom-server|server|cli)\.js/i;
const LEGACY_LAUNCHER = /9router[\\/]cli\.js/i;

function isLegacyNodeProcess(cmdline) {
  const text = String(cmdline || "");
  return NODE_EXEC.test(text) && LEGACY_DIR.test(text) && LEGACY_SCRIPT.test(text);
}

function isLegacyLauncher(cmdline) {
  const text = String(cmdline || "");
  return NODE_EXEC.test(text) && LEGACY_LAUNCHER.test(text);
}

const fs = require("fs");

const RENAMED_TITLE = /^next-server\b/i;
const NODE_EXE = /(^|[\\/])node(js)?(\.exe)?$/i;
const NEW_PRODUCT = /literouter/i;

function classifyListener(info, parent) {
  if (!info) return "other";
  const cmdline = String(info.cmdline || "");
  if (isLegacyNodeProcess(cmdline)) return "legacy";
  const renamed = RENAMED_TITLE.test(cmdline);
  const nodeExe = NODE_EXE.test(String(info.exe || ""));
  const cwdLegacy = LEGACY_DIR.test(`${String(info.cwd || "").replace(/[\\/]*$/, "")}/`);
  const parentLauncher = !!parent && isLegacyLauncher(parent.cmdline);
  if ((renamed || nodeExe) && parentLauncher) return "legacy";
  if (renamed && cwdLegacy) return "legacy";
  if (renamed || (cwdLegacy && !NEW_PRODUCT.test(cmdline))) return "suspect";
  if (/9router/i.test(cmdline) && !NEW_PRODUCT.test(cmdline)) return "suspect";
  return "other";
}

function parseProcessInfo(output, format = "cim") {
  const text = String(output || "").trim();
  if (!text) return null;
  const match = format === "ps" ? text.match(/^(\d+)\s+(.*)$/s) : text.match(/^(\d+)\|(.*)$/s);
  if (!match) return null;
  return { ppid: parseInt(match[1], 10), cmdline: match[2].trim() };
}

function parseProcCmdline(raw) {
  return String(raw || "")
    .split("\0")
    .filter((part) => part !== "")
    .join(" ");
}

function parseProcStatPpid(stat) {
  const match = String(stat || "").match(/\)\s+\S+\s+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function readLinkOrUndefined(file) {
  try {
    return fs.readlinkSync(file);
  } catch {
    return undefined;
  }
}

function getLinuxProcessInfo(pid) {
  try {
    const ppid = parseProcStatPpid(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (ppid === null) return null;
    const cmdline = parseProcCmdline(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"));
    return {
      ppid,
      cmdline,
      exe: readLinkOrUndefined(`/proc/${pid}/exe`),
      cwd: readLinkOrUndefined(`/proc/${pid}/cwd`),
    };
  } catch {
    return null;
  }
}

async function getProcessInfo(pid) {
  if (process.platform === "linux") {
    const viaProc = getLinuxProcessInfo(pid);
    if (viaProc) return viaProc;
  }
  try {
    const win = process.platform === "win32";
    const cmd = win
      ? [
          "powershell",
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}') | % { "$($_.ParentProcessId)|$($_.CommandLine)" }`,
        ]
      : ["ps", "-o", "ppid=,command=", "-p", String(pid)];
    const proc = Bun.spawn(cmd, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return parseProcessInfo(out, win ? "cim" : "ps");
  } catch {
    return null;
  }
}

async function findLegacyTarget(deps, ports) {
  const { getListenerPid, getProcessInfo: infoOf } = deps;
  for (const port of ports) {
    const pid = getListenerPid(port);
    if (pid === null || pid === undefined) {
      if (deps.isPortOpen && (await deps.isPortOpen(port))) return { ambiguous: { stopped: false, ambiguous: true, pid: null, port } };
      continue;
    }
    const info = await infoOf(pid);
    const parent = info && info.ppid ? await infoOf(info.ppid) : null;
    const kind = classifyListener(info, parent);
    if (kind === "legacy") {
      return { target: { pid, port, ppid: info.ppid, launcher: parent && isLegacyLauncher(parent.cmdline) } };
    }
    if (kind === "suspect") return { ambiguous: { stopped: false, ambiguous: true, pid, port } };
  }
  return {};
}

async function stopLegacyServer(deps) {
  const { readServerPid, getListenerPid, kill, sleep, log } = deps;
  const record = readServerPid();
  if (record && record.launcherPid) return { stopped: false };
  const ports = [...new Set([record && record.port, deps.port].filter((p) => Number.isInteger(p)))];
  const { target, ambiguous } = await findLegacyTarget(deps, ports);
  if (ambiguous) return ambiguous;
  if (!target) return { stopped: false };

  const { pid, port } = target;
  let launcherPid;
  if (target.launcher) {
    launcherPid = target.ppid;
    kill(launcherPid, "launcher");
    for (let i = 0; i < 20 && getListenerPid(port) !== null; i++) await sleep(100);
  }

  if (getListenerPid(port) === pid) {
    kill(pid, "server");
    for (let i = 0; i < 20 && getListenerPid(port) === pid; i++) await sleep(100);
    if (!launcherPid) {
      for (let i = 0; i < 20; i++) {
        const listener = getListenerPid(port);
        if (listener !== null && listener !== pid) {
          log(`The old 9router server (pid ${pid}) was stopped but a new one (pid ${listener}) is listening again: the old 9router launcher is still running. Quit it (close its terminal or tray icon), then start LiteRouter again.`);
          return { stopped: false, respawned: true };
        }
        await sleep(100);
      }
    }
  }

  log(`Stopped the server started by the old 9router CLI (pid ${pid}). Remove the old global 9router package with the package manager you installed it with.`);
  return { stopped: true, launcherPid, serverPid: pid };
}

async function takeoverLegacy({ stop = stopLegacyServer, isAutoStartEnabled, enableAutoStart, cliPath, host, port, ...deps }) {
  const result = await stop({ ...deps, port });
  if (result.stopped && isAutoStartEnabled()) enableAutoStart(cliPath, { host, port });
  return result;
}

module.exports = {
  isLegacyNodeProcess,
  isLegacyLauncher,
  classifyListener,
  parseProcCmdline,
  parseProcStatPpid,
  parseProcessInfo,
  getProcessInfo,
  stopLegacyServer,
  takeoverLegacy,
};
