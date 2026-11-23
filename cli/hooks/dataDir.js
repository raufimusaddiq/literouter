const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_NAME = "literouter";
const LEGACY_APP_NAME = "9router";

function baseDir(platform, env, home) {
  const join = platform === "win32" ? path.win32.join : path.join;
  return {
    join,
    root: platform === "win32" ? env.APPDATA || join(home, "AppData", "Roaming") : home,
    name: (app) => (platform === "win32" ? app : `.${app}`),
    shown: (app) => (platform === "win32" ? `%APPDATA%${path.win32.sep}${app}` : `~/.${app}`),
  };
}

function resolveDataDir({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  exists = fs.existsSync,
  mkdir = (dir) => fs.mkdirSync(dir, { recursive: true }),
  warn = () => {},
} = {}) {
  const { join, root, name, shown } = baseDir(platform, env, home);
  const current = join(root, name(APP_NAME));
  const legacy = join(root, name(LEGACY_APP_NAME));

  const pickDefault = () => {
    if (!exists(current) && exists(legacy)) return { dir: legacy, source: "legacy", label: shown(LEGACY_APP_NAME) };
    return { dir: current, source: "default", label: shown(APP_NAME) };
  };

  const configured = env.DATA_DIR;
  if (!configured) return pickDefault();

  if (platform === "win32" && /^\//.test(configured)) {
    warn(`[DATA_DIR] '${configured}' is a Unix path on Windows, falling back to the default`);
    return pickDefault();
  }

  try {
    mkdir(configured);
    return { dir: configured, source: "env", label: configured };
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      warn(`[DATA_DIR] '${configured}' not writable, falling back to the default`);
      return pickDefault();
    }
    throw e;
  }
}

function describeDataDir({ dir, source, label }) {
  if (source === "legacy") {
    return `[DATA_DIR] using legacy ${label} at ${dir} (rename to ${label.replace(LEGACY_APP_NAME, APP_NAME)} when no old 9router is running)`;
  }
  return `[DATA_DIR] using ${dir}`;
}

function getDataDir() {
  return resolveDataDir({ warn: (m) => console.warn(m) }).dir;
}

module.exports = { resolveDataDir, describeDataDir, getDataDir, APP_NAME, LEGACY_APP_NAME };
