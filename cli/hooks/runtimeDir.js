const fs = require("fs");
const path = require("path");
const { getDataDir } = require("./dataDir");

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), "node_modules");
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "literouter-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable runtime deps for literouter",
    }, null, 2));
  }
  return dir;
}

module.exports = { getDataDir, getRuntimeDir, getRuntimeNodeModules, ensureRuntimeDir };
