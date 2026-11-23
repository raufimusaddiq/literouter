const fs = require("fs");
const path = require("path");
const { getRuntimeNodeModules } = require("./sqliteRuntime");

const SYSTRAY_PKG = "systray2";
const SYSTRAY_VERSION = "2.1.4";
const LEGACY_SYSTRAY_PKG = "systray";

function hasSystray() {
  return fs.existsSync(path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "package.json"));
}

function cleanupLegacySystray({ silent = false } = {}) {
  const targets = [
    path.join(getRuntimeNodeModules(), LEGACY_SYSTRAY_PKG),
    path.join(__dirname, "..", "node_modules", LEGACY_SYSTRAY_PKG)
  ];
  for (const dir of targets) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        if (!silent) console.log(`[9router][runtime] removed legacy systray: ${dir}`);
      } catch (e) {
        if (!silent) console.warn(`[9router][runtime] failed to remove ${dir}: ${e.message}`);
      }
    }
  }
}

function chmodSystrayBin({ silent = false } = {}) {
  if (process.platform === "win32") return;
  const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
  const binPath = path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "traybin", binName);
  if (!fs.existsSync(binPath)) return;
  try {
    fs.chmodSync(binPath, 0o755);
  } catch (e) {
    if (!silent) console.warn(`[9router][runtime] chmod tray bin failed: ${e.message}`);
  }
}

function getTrayPackages({ silent = true } = {}) {
  cleanupLegacySystray({ silent });
  if (process.platform === "win32") return [];
  if (hasSystray()) {
    chmodSystrayBin({ silent });
    return [];
  }
  return [{ name: SYSTRAY_PKG, version: SYSTRAY_VERSION }];
}

module.exports = { getTrayPackages, chmodSystrayBin };
