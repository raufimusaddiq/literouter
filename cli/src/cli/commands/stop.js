const fs = require("fs");

const DEFAULT_PORT = 20128;
const RESPAWN_POLLS = 20;
const POLL_MS = 100;
const BIN_PATH = /[\\/]literouter(\.(cmd|exe|ps1|js))?(["'\s]|$)/i;

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function safeRealpath(realpath, value) {
  try {
    return realpath(value);
  } catch {
    return value;
  }
}

function looksLikeOurLauncher(cmdline, cliPath, realpath) {
  const text = normalizePath(cmdline);
  const candidates = [cliPath, safeRealpath(realpath, cliPath)].map(normalizePath).filter(Boolean);
  return candidates.some((candidate) => text.includes(candidate)) || BIN_PATH.test(String(cmdline || ""));
}

async function ownsLauncher(record, deps) {
  const { cliPath, getProcessInfo, realpath = fs.realpathSync } = deps;
  const launcher = await getProcessInfo(record.launcherPid);
  if (!launcher) return false;
  const server = await getProcessInfo(record.pid);
  if (server && Number.isInteger(server.ppid) && server.ppid > 0) return server.ppid === record.launcherPid;
  return looksLikeOurLauncher(launcher.cmdline, cliPath, realpath);
}

async function waitWhile(predicate, sleep) {
  for (let i = 0; i < RESPAWN_POLLS && predicate(); i++) await sleep(POLL_MS);
}

async function runStop(deps) {
  const { readServerPid, clearServerPid, getListenerPid, isTrackedServerAlive, kill, sleep, log } = deps;

  const record = readServerPid();
  if (!record) {
    log("LiteRouter is not running.");
    return 0;
  }

  const port = record.port ?? DEFAULT_PORT;
  const listener = getListenerPid(port);
  if (!isTrackedServerAlive(record.pid, listener)) {
    if (listener === null && deps.isPidAlive && deps.isPidAlive(record.pid) && deps.isPortOpen && (await deps.isPortOpen(port))) {
      log(`Cannot tell which process listens on port ${port}, and pid ${record.pid} from the pid file is still running. The pid file was kept. Install lsof or ss, or stop pid ${record.pid} yourself.`);
      return 1;
    }
    clearServerPid();
    log("LiteRouter is not running (removed a stale pid file).");
    return 0;
  }

  if (record.launcherPid && record.launcherPid !== process.pid && (await ownsLauncher(record, deps))) {
    kill(record.launcherPid, "launcher");
    await waitWhile(() => getListenerPid(port) === record.pid, sleep);
  }

  if (getListenerPid(port) === record.pid) {
    kill(record.pid, "server");
    await waitWhile(() => getListenerPid(port) === record.pid, sleep);
  }

  if (getListenerPid(port) === record.pid) {
    log(`Could not stop the LiteRouter server (pid ${record.pid}) on port ${port}.`);
    return 1;
  }

  if (record.launcherPid) {
    for (let i = 0; i < RESPAWN_POLLS; i++) {
      const listener = getListenerPid(port);
      if (listener !== null) {
        log(`The LiteRouter server was stopped but a new one (pid ${listener}) is listening on port ${port} again. Its launcher is still running; close it and run "literouter stop" again.`);
        return 1;
      }
      await sleep(POLL_MS);
    }
  }

  clearServerPid();
  log(`Stopped the LiteRouter server (pid ${record.pid}).`);
  return 0;
}

module.exports = { runStop, DEFAULT_PORT };
