const net = require("net");
const { execSync } = require("child_process");
const { getProcessInfo } = require("./legacyCli");
const { killLauncher } = require("./killProc");
const { getListenerPid } = require("./listener");
const { readServerPid, clearServerPid, isTrackedServerAlive } = require("./serverProc");

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "ignore", timeout: 3000 });
    }
  } catch (e) {}
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!e && e.code === "EPERM";
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function killProcess(pid, kind) {
  if (kind === "launcher") {
    killLauncher(pid, {
      killPid,
      signalPid: (target, signal) => {
        try {
          process.kill(target, signal);
        } catch (e) {}
      },
    });
    return;
  }
  killPid(pid);
}

function createRuntimeDeps({ cliPath, ...overrides }) {
  return {
    cliPath,
    readServerPid,
    clearServerPid,
    getListenerPid,
    isPidAlive,
    isPortOpen,
    isTrackedServerAlive,
    getProcessInfo,
    kill: killProcess,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: console.log,
    ...overrides,
  };
}

module.exports = { createRuntimeDeps, killPid, isPidAlive, isPortOpen, killProcess };
