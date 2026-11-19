// Process + port helpers for the launcher: pidfile tracking, exact-port
// matching, and the tray/autostart argument list.
const fs = require("fs");
const path = require("path");
const { getRuntimeDir } = require("../../../hooks/sqliteRuntime");

// Server pid lives next to the runtime dir in the user data dir.
function getPidFile() {
  return path.join(path.dirname(getRuntimeDir()), "server.pid");
}

// The record carries the port too, so ownership is checked against "the
// listener on the port we recorded", not just a bare PID that the OS may have
// recycled to an unrelated process after a reboot.
function writeServerPid(pid, port) {
  try {
    const file = getPidFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid, port, startedAt: Date.now() }));
  } catch (e) {}
}

// Returns {pid, port} or null. Accepts the legacy bare-integer format.
function readServerPid() {
  try {
    const raw = fs.readFileSync(getPidFile(), "utf8").trim();
    if (/^\d+$/.test(raw)) {
      const pid = parseInt(raw, 10);
      return pid > 0 ? { pid, port: null } : null;
    }
    const rec = JSON.parse(raw);
    const pid = parseInt(rec && rec.pid, 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const port = parseInt(rec.port, 10);
    return { pid, port: Number.isInteger(port) ? port : null };
  } catch (e) {
    return null;
  }
}

// Is this PID still OUR server? Only if it is the process listening on the
// port we recorded — a recycled PID that merely exists is not ours to kill.
function isTrackedServerAlive(trackedPid, listenerPid) {
  const tracked = parseInt(trackedPid, 10);
  const listener = parseInt(listenerPid, 10);
  return Number.isInteger(tracked) && tracked > 0 && tracked === listener;
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
  isTrackedServerAlive,
  parseNetstatListeners,
  findListenerPid,
  buildTrayArgs,
};
