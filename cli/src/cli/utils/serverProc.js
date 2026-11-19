// Process + port helpers for the launcher: pidfile tracking, exact-port
// matching, and the tray/autostart argument list.
const fs = require("fs");
const path = require("path");
const { getRuntimeDir } = require("../../../hooks/sqliteRuntime");

// Server pid lives next to the runtime dir in the user data dir.
function getPidFile() {
  return path.join(path.dirname(getRuntimeDir()), "server.pid");
}

function writeServerPid(pid) {
  try {
    const file = getPidFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(pid));
  } catch (e) {}
}

function readServerPid() {
  try {
    const pid = parseInt(fs.readFileSync(getPidFile(), "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

function clearServerPid() {
  try { fs.unlinkSync(getPidFile()); } catch (e) {}
}

// Parse `netstat -ano` output. Only LISTENING rows count, and the port is
// taken from the local-address column and compared exactly: 2012 must never
// match 20128.
function parseNetstatListeners(output) {
  const listeners = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    // Proto  LocalAddress  ForeignAddress  State  PID
    if (cols.length < 5) continue;
    const local = cols[1];
    const port = parseInt(local.slice(local.lastIndexOf(":") + 1), 10);
    const pid = parseInt(cols[cols.length - 1], 10);
    if (!Number.isInteger(port) || !Number.isInteger(pid)) continue;
    listeners.push({ port, pid });
  }
  return listeners;
}

// PID listening on exactly `port`, or null.
function findListenerPid(netstatOutput, port) {
  const hit = parseNetstatListeners(netstatOutput).find((l) => l.port === port);
  return hit ? hit.pid : null;
}

// Args for a detached tray child — shared by hide-to-tray respawn and the
// OS autostart entries, so the bound host/port survive both.
function buildTrayArgs({ host = "0.0.0.0", port = 20128 } = {}) {
  return ["--tray", "--skip-update", "-H", String(host), "-p", String(port)];
}

module.exports = {
  getPidFile,
  writeServerPid,
  readServerPid,
  clearServerPid,
  parseNetstatListeners,
  findListenerPid,
  buildTrayArgs,
};
