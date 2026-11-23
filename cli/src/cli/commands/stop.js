const DEFAULT_PORT = 20128;

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

async function runStop(deps) {
  const { cliPath, readServerPid, clearServerPid, getListenerPid, isTrackedServerAlive, getProcessInfo, kill, sleep, log } = deps;

  const record = readServerPid();
  if (!record) {
    log("LiteRouter is not running.");
    return 0;
  }

  const port = record.port ?? DEFAULT_PORT;
  if (!isTrackedServerAlive(record.pid, getListenerPid(port))) {
    clearServerPid();
    log("LiteRouter is not running (removed a stale pid file).");
    return 0;
  }

  if (record.launcherPid && record.launcherPid !== process.pid) {
    const info = await getProcessInfo(record.launcherPid);
    if (info && normalizePath(info.cmdline).includes(normalizePath(cliPath))) {
      kill(record.launcherPid, "launcher");
      for (let i = 0; i < 20 && getListenerPid(port) === record.pid; i++) await sleep(100);
    }
  }

  if (getListenerPid(port) === record.pid) {
    kill(record.pid, "server");
    for (let i = 0; i < 20 && getListenerPid(port) === record.pid; i++) await sleep(100);
  }

  if (getListenerPid(port) === record.pid) {
    log(`Could not stop the LiteRouter server (pid ${record.pid}) on port ${port}.`);
    return 1;
  }

  clearServerPid();
  log(`Stopped the LiteRouter server (pid ${record.pid}).`);
  return 0;
}

module.exports = { runStop, DEFAULT_PORT };
