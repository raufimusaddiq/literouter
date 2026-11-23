import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { bunCommand } from "@/lib/runtimeBun.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
export const PXPIPE_PACKAGE = "pxpipe-proxy";
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

let installInFlight = null;

function ensureDir() {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true });
}

export function packageRoot() {
  return path.join(PXPIPE_DIR, "node_modules", PXPIPE_PACKAGE);
}

export function libraryEntry() {
  return path.join(packageRoot(), "dist", "core", "library.js");
}

export function findNpm() {
  return bunCommand().command || null;
}

export function getInstallInfo() {
  try {
    const pkgJson = path.join(packageRoot(), "package.json");
    if (!fs.existsSync(pkgJson) || !fs.existsSync(libraryEntry())) {
      return { installed: false, version: null, path: null };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    return { installed: true, version: pkg.version || null, path: packageRoot() };
  } catch {
    return { installed: false, version: null, path: null };
  }
}

export function isInstalling() {
  return installInFlight !== null;
}

export function installPxpipe() {
  if (installInFlight) return installInFlight;
  installInFlight = runInstall().finally(() => { installInFlight = null; });
  return installInFlight;
}

async function runInstall() {
  const bun = findNpm();
  if (!bun) {
    const err = new Error("bun executable not found — Bun is required to install PXPIPE");
    err.code = "NPM_NOT_FOUND";
    throw err;
  }

  ensureDir();
  const pkgJson = path.join(PXPIPE_DIR, "package.json");
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: "literouter-pxpipe-host", private: true }, null, 2));
  }

  const outFd = fs.openSync(INSTALL_LOG, "a");
  fs.writeSync(outFd, `\n[${new Date().toISOString()}] bun add ${PXPIPE_PACKAGE}@latest\n`);

  try {
    const child = Bun.spawn([bun, "add", `${PXPIPE_PACKAGE}@latest`], {
      cwd: PXPIPE_DIR,
      stdin: "ignore",
      stdout: outFd,
      stderr: outFd,
      windowsHide: true,
      env: { ...process.env, ...bunCommand().env },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, INSTALL_TIMEOUT_MS);
    const code = await child.exited.finally(() => clearTimeout(timer));
    if (timedOut) throw new Error("bun add timed out after 5 minutes — see install.log");
    if (code !== 0) throw new Error(`bun add exited with code ${code} — see install.log`);
  } finally {
    fs.closeSync(outFd);
  }

  const info = getInstallInfo();
  if (!info.installed) throw new Error("install finished but package is missing — see install.log");
  return info;
}

export function getInstallLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(INSTALL_LOG)) return "";
    const lines = fs.readFileSync(INSTALL_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
