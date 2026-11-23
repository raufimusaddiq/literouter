const fs = require("fs");
const { execSync } = require("child_process");
const { findListenerPid } = require("./serverProc");

const TCP_LISTEN = "0A";

function parseProcNetTcp(text, port) {
  const wanted = Number(port).toString(16).toUpperCase().padStart(4, "0");
  const inodes = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10) continue;
    const local = cols[1];
    const colon = local.lastIndexOf(":");
    if (colon < 0) continue;
    if (cols[3] !== TCP_LISTEN) continue;
    if (local.slice(colon + 1).toUpperCase() !== wanted) continue;
    if (/^\d+$/.test(cols[9]) && cols[9] !== "0") inodes.push(cols[9]);
  }
  return inodes;
}

function parseSsListeners(output, port) {
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!/^LISTEN\b/.test(line.trim())) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[3] || "";
    if (parseInt(local.slice(local.lastIndexOf(":") + 1), 10) !== port) continue;
    const pid = line.match(/pid=(\d+)/);
    if (pid) return parseInt(pid[1], 10);
  }
  return null;
}

function findPidByInodes(inodes, deps) {
  if (!inodes.length) return null;
  const wanted = new Set(inodes.map((inode) => `socket:[${inode}]`));
  const pids = deps
    .listPids()
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
  for (const pid of pids) {
    let fds;
    try {
      fds = deps.listDir(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (wanted.has(deps.readLink(`/proc/${pid}/fd/${fd}`))) return parseInt(pid, 10);
      } catch {}
    }
  }
  return null;
}

function defaultDeps() {
  return {
    platform: process.platform,
    exec: (cmd) => execSync(cmd, { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }),
    readFile: (file) => fs.readFileSync(file, "utf8"),
    listPids: () => fs.readdirSync("/proc"),
    listDir: (dir) => fs.readdirSync(dir),
    readLink: (file) => fs.readlinkSync(file),
  };
}

function tryExec(deps, cmd) {
  try {
    return String(deps.exec(cmd) || "");
  } catch {
    return "";
  }
}

function fromLsof(deps, port) {
  const pid = parseInt(tryExec(deps, `lsof -tiTCP:${port} -sTCP:LISTEN`).trim().split("\n")[0], 10);
  return Number.isInteger(pid) ? pid : null;
}

function fromProc(deps, port) {
  const inodes = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      inodes.push(...parseProcNetTcp(deps.readFile(table), port));
    } catch {}
  }
  return findPidByInodes(inodes, deps);
}

function getListenerPid(port, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    if (deps.platform === "win32") return findListenerPid(tryExec(deps, "netstat -ano -p TCP"), port);
    const viaLsof = fromLsof(deps, port);
    if (viaLsof !== null || deps.platform !== "linux") return viaLsof;
    const viaSs = parseSsListeners(tryExec(deps, "ss -ltnpH"), port);
    if (viaSs !== null) return viaSs;
    return fromProc(deps, port);
  } catch {
    return null;
  }
}

module.exports = { parseProcNetTcp, parseSsListeners, findPidByInodes, getListenerPid };
