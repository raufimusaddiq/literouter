const fs = require("fs");
const path = require("path");
const { getRuntimeDir, ensureRuntimeDir } = require("./runtimeDir");
const { getTrayPackages, chmodSystrayBin } = require("./trayRuntime");

const INSTALL_TIMEOUT_MS = 180000;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

function markerPath() {
  return path.join(getRuntimeDir(), ".install-failed");
}

function lockPath() {
  return path.join(getRuntimeDir(), ".install-lock");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function buildBunAddArgs(packages) {
  return ["add", ...packages.map((p) => `${p.name}@${p.version}`)];
}

function summarizeBunError(stderr = "") {
  const text = String(stderr);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|getaddrinfo|ConnectionRefused|FailedToOpenSocket/i.test(text)) return "No internet connection or registry unreachable";
  if (/EACCES|EPERM|permission denied/i.test(text)) return "Permission denied (check folder permissions)";
  if (/ENOSPC|no space/i.test(text)) return "Not enough disk space";
  if (/not found|No version matching|ETARGET/i.test(text)) return "Package version not found on registry";
  const m = text.match(/error: (.+)/);
  if (m) return m[1].slice(0, 200);
  const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
  return lastLine ? lastLine.slice(0, 200) : "Unknown error";
}

function backoffMs(failures) {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

function isInBackoff(now = Date.now()) {
  const marker = readJson(markerPath());
  if (!marker || !Number.isFinite(marker.at)) return false;
  return now < marker.at + backoffMs(marker.failures || 1);
}

function recordFailure(reason) {
  const prev = readJson(markerPath());
  try {
    fs.writeFileSync(markerPath(), JSON.stringify({ at: Date.now(), failures: ((prev && prev.failures) || 0) + 1, reason }));
  } catch {}
}

function clearFailure() {
  try {
    fs.rmSync(markerPath(), { force: true });
  } catch {}
}

async function runBunAdd({ cwd, args, spawn, timeout = INSTALL_TIMEOUT_MS }) {
  let proc;
  try {
    proc = spawn([process.execPath, ...args], { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  } catch (e) {
    return { ok: false, stderr: e.message };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeout);
  let stderr = "";
  try {
    stderr = await new Response(proc.stderr).text();
  } catch {}
  const code = await proc.exited;
  clearTimeout(timer);
  if (timedOut) return { ok: false, stderr: "ETIMEDOUT: bun add timed out" };
  return { ok: code === 0, stderr: stderr.slice(-20000) };
}

async function ensureRuntime({ silent = true, spawn = Bun.spawn } = {}) {
  try {
    if (process.platform === "win32") return { skipped: "windows" };
    const packages = getTrayPackages({ silent });
    if (packages.length === 0) return { skipped: "ready" };

    const dir = ensureRuntimeDir();
    if (isInBackoff()) return { skipped: "backoff" };
    const lock = readJson(lockPath());
    if (lock && Date.now() - lock.at < INSTALL_TIMEOUT_MS + 10000) return { skipped: "locked" };
    fs.writeFileSync(lockPath(), JSON.stringify({ at: Date.now(), pid: process.pid }));

    try {
      if (!silent) console.log("Installing runtime dependencies in background...");
      const res = await runBunAdd({ cwd: dir, args: buildBunAddArgs(packages), spawn });
      if (res.ok) {
        clearFailure();
        chmodSystrayBin({ silent });
        return { ok: true };
      }
      const reason = summarizeBunError(res.stderr);
      recordFailure(reason);
      if (!silent) console.warn(`Runtime dependency install failed (${reason}). Will retry later.`);
      return { ok: false, reason };
    } finally {
      try {
        fs.rmSync(lockPath(), { force: true });
      } catch {}
    }
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { ensureRuntime, buildBunAddArgs, summarizeBunError, backoffMs, isInBackoff };
