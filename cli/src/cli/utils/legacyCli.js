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

function parseProcessInfo(output, format = "cim") {
  const text = String(output || "").trim();
  if (!text) return null;
  const match = format === "ps" ? text.match(/^(\d+)\s+(.*)$/s) : text.match(/^(\d+)\|(.*)$/s);
  if (!match) return null;
  return { ppid: parseInt(match[1], 10), cmdline: match[2].trim() };
}

async function getProcessInfo(pid) {
  try {
    const win = process.platform === "win32";
    const cmd = win
      ? [
          "powershell",
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}') | % { "$($_.ParentProcessId)|$($_.CommandLine)" }`,
        ]
      : ["ps", "-o", "ppid=,args=", "-p", String(pid)];
    const proc = Bun.spawn(cmd, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return parseProcessInfo(out, win ? "cim" : "ps");
  } catch {
    return null;
  }
}

async function stopLegacyServer(deps) {
  const { readServerPid, getListenerPid, isTrackedServerAlive, getProcessInfo: infoOf, kill, sleep, log } = deps;
  const record = readServerPid();
  if (!record || record.launcherPid) return { stopped: false };
  if (!isTrackedServerAlive(record.pid, getListenerPid(record.port))) return { stopped: false };

  const info = await infoOf(record.pid);
  if (!info || !isLegacyNodeProcess(info.cmdline)) return { stopped: false };

  let launcherPid;
  const parent = info.ppid ? await infoOf(info.ppid) : null;
  if (parent && isLegacyLauncher(parent.cmdline)) {
    launcherPid = info.ppid;
    kill(launcherPid, "launcher");
    for (let i = 0; i < 20 && getListenerPid(record.port) !== null; i++) await sleep(100);
  }

  if (getListenerPid(record.port) === record.pid) {
    kill(record.pid, "server");
    for (let i = 0; i < 20 && getListenerPid(record.port) === record.pid; i++) await sleep(100);
    if (!launcherPid) {
      for (let i = 0; i < 20; i++) {
        const listener = getListenerPid(record.port);
        if (listener !== null && listener !== record.pid) {
          log(`The old 9router server (pid ${record.pid}) was stopped but a new one (pid ${listener}) is listening again: the old 9router launcher is still running. Quit it (close its terminal or tray icon), then start LiteRouter again.`);
          return { stopped: false, respawned: true };
        }
        await sleep(100);
      }
    }
  }

  log(`Stopped the server started by the old 9router CLI (pid ${record.pid}). Remove the old global 9router package with the package manager you installed it with.`);
  return { stopped: true, launcherPid, serverPid: record.pid };
}

async function takeoverLegacy({ stop = stopLegacyServer, isAutoStartEnabled, enableAutoStart, cliPath, host, port, ...deps }) {
  const result = await stop(deps);
  if (result.stopped && isAutoStartEnabled()) enableAutoStart(cliPath, { host, port });
  return result;
}

module.exports = {
  isLegacyNodeProcess,
  isLegacyLauncher,
  parseProcessInfo,
  getProcessInfo,
  stopLegacyServer,
  takeoverLegacy,
};
