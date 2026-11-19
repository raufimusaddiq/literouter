// Ensure better-sqlite3 is installed in USER_DATA_DIR/runtime/node_modules
// (user-writable, avoids Windows EBUSY locks during npm i -g updates).
// sql.js is bundled in bin/app already; node:sqlite / bun:sqlite are built-in.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Gate the pinned version by Node major, mirroring src/lib/db/driver.js gating
// style: 13.x is N-API and ships per-platform prebuilds inside the package, so
// it needs no ABI-specific download. It requires Node >= 22; older runtimes stay
// on 12.6.2, which fetches an ABI-specific binary via prebuild-install.
const [NODE_MAJOR] = process.versions.node.split(".").map(Number);
const USE_NAPI_BUILD = NODE_MAJOR >= 22;
const BETTER_SQLITE3_VERSION = USE_NAPI_BUILD ? "13.0.3" : "12.6.2";
const SQL_JS_VERSION = "1.14.1";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "9router")
    : path.join(os.homedir(), ".9router");
}

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), "node_modules");
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Minimal package.json so npm treats it as a project root
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable runtime deps for 9router (better-sqlite3 native binary)",
    }, null, 2));
  }
  return dir;
}

function hasModule(name) {
  return fs.existsSync(path.join(getRuntimeNodeModules(), name, "package.json"));
}

function isGlibcRuntime() {
  try { return Boolean(process.report?.getReport()?.header?.glibcVersionRuntime); } catch { return true; }
}

// 12.x compiles/downloads into build/Release; 13.x ships prebuilds/<platform>-<arch>.node.
function getBetterSqliteBinary() {
  const root = path.join(getRuntimeNodeModules(), "better-sqlite3");
  const platform = process.platform === "linux" && !isGlibcRuntime() ? "linuxmusl" : process.platform;
  return [
    path.join(root, "build", "Release", "better_sqlite3.node"),
    path.join(root, "prebuilds", `${platform}-${process.arch}.node`),
  ].find((file) => fs.existsSync(file));
}

function isBetterSqliteBinaryValid() {
  const binary = getBetterSqliteBinary();
  if (!binary) return false;
  try {
    const fd = fs.openSync(binary, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (process.platform === "linux") return magic.startsWith("7f454c46");
    if (process.platform === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    if (process.platform === "win32") return magic.startsWith("4d5a");
    return true;
  } catch { return false; }
}

// Extract a short, user-friendly reason from npm stderr.
function summarizeNpmError(stderr = "") {
  const text = String(stderr);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|getaddrinfo/i.test(text)) return "No internet connection or registry unreachable";
  if (/EACCES|EPERM|permission denied/i.test(text)) return "Permission denied (check folder permissions)";
  if (/ENOSPC|no space/i.test(text)) return "Not enough disk space";
  if (/node-gyp|gyp ERR|python|MSBuild|Visual Studio|Xcode/i.test(text)) return "Missing build tools (Xcode CLT / Python / VS Build Tools)";
  if (/ETARGET|version.*not found/i.test(text)) return "Package version not found on registry";
  const m = text.match(/npm (?:ERR!|error) (?!A complete log)(.+)/);
  if (m) return m[1].slice(0, 200);
  const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
  return lastLine ? lastLine.slice(0, 200) : "Unknown error";
}

const INSTALL_TIMEOUT_MS = 180000;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

function markerPath() { return path.join(getRuntimeDir(), ".install-failed"); }
function lockPath() { return path.join(getRuntimeDir(), ".install-lock"); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Backoff window after failed installs: 5m, 10m, 20m ... capped at 24h.
function backoffMs(failures) {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

function isInBackoff(now = Date.now()) {
  const m = readJson(markerPath());
  if (!m || !Number.isFinite(m.at)) return false;
  return now < m.at + backoffMs(m.failures || 1);
}

function recordFailure(reason) {
  const prev = readJson(markerPath());
  try {
    fs.writeFileSync(markerPath(), JSON.stringify({ at: Date.now(), failures: ((prev && prev.failures) || 0) + 1, reason }));
  } catch {}
}

function clearFailure() {
  try { fs.rmSync(markerPath(), { force: true }); } catch {}
}

// Async npm install: never blocks the event loop, so server start is not delayed.
function runNpmInstall({ cwd, args, timeout = INSTALL_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    let stderr = "";
    let settled = false;
    let timer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stderr, ...r });
    };
    let child;
    try {
      const npmArgs = ["install", ...args, "--no-audit", "--no-fund", "--prefer-online"];
      const stdio = ["ignore", "ignore", "pipe"];
      // Windows needs a shell for npm.cmd; pass one command string (args are
      // static flags) rather than an args array to avoid Node's DEP0190 warning.
      child = process.platform === "win32"
        ? spawn(`${npmCmd} ${npmArgs.join(" ")}`, { cwd, stdio, shell: true, windowsHide: true })
        : spawn(npmCmd, npmArgs, { cwd, stdio });
    } catch (e) {
      return finish({ ok: false, stderr: e.message });
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, stderr: "ETIMEDOUT: npm install timed out" });
    }, timeout);
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on("error", (e) => finish({ ok: false, stderr: e.message }));
    child.on("close", (code) => finish({ ok: code === 0, code }));
  });
}

function isSqlJsWasmValid() {
  const bundledWasm = path.join(__dirname, "..", "app", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  if (fs.existsSync(bundledWasm)) return true;
  return fs.existsSync(path.join(getRuntimeNodeModules(), "sql.js", "dist", "sql-wasm.wasm"));
}

// One combined install: sql.js, better-sqlite3 and (non-Windows) systray2 go in
// a single `npm install` and are written into the runtime package.json, so a
// later install of one cannot prune the other. Native packages are saved as
// optionalDependencies so a failed native build does not fail the whole install.
// Returns { skipped, ok, reason? }. Never throws.
async function installRuntime({ silent = true, extraPackages = [] } = {}) {
  try {
    const dir = ensureRuntimeDir();
    const needSqlJs = !isSqlJsWasmValid();
    const needBetter = !hasModule("better-sqlite3") || !isBetterSqliteBinaryValid();
    const needExtra = extraPackages.filter((p) => !hasModule(p.name));
    if (!needSqlJs && !needBetter && needExtra.length === 0) return { skipped: "ready" };

    if (isInBackoff()) return { skipped: "backoff" };
    const lock = readJson(lockPath());
    if (lock && Date.now() - lock.at < INSTALL_TIMEOUT_MS + 10000) return { skipped: "locked" };
    fs.writeFileSync(lockPath(), JSON.stringify({ at: Date.now(), pid: process.pid }));

    try {
      if (!silent) console.log("⏳ Installing runtime dependencies in background...");
      // Declare every dep in the runtime package.json, then run one plain
      // `npm install`: nothing can be pruned and native packages (optional)
      // may fail without failing sql.js.
      const pkgPath = path.join(dir, "package.json");
      const manifest = readJson(pkgPath) || { name: "9router-runtime", version: "1.0.0", private: true };
      manifest.dependencies = { ...manifest.dependencies, "sql.js": SQL_JS_VERSION };
      manifest.optionalDependencies = {
        ...manifest.optionalDependencies,
        "better-sqlite3": BETTER_SQLITE3_VERSION,
        ...Object.fromEntries(extraPackages.map((p) => [p.name, p.version])),
      };
      fs.writeFileSync(pkgPath, JSON.stringify(manifest, null, 2));
      // 13.x bundles prebuilds; skip the implicit `node-gyp rebuild`.
      const res = await runNpmInstall({ cwd: dir, args: USE_NAPI_BUILD ? ["--ignore-scripts"] : [] });
      const ok = res.ok;
      if (ok) clearFailure();
      else {
        const reason = summarizeNpmError(res.stderr);
        recordFailure(reason);
        if (!silent) console.warn(`⚠️  Runtime dependency install failed (${reason}); using fallbacks. Will retry later.`);
      }
      return { ok, reason: ok ? undefined : summarizeNpmError(res.stderr) };
    } finally {
      try { fs.rmSync(lockPath(), { force: true }); } catch {}
    }
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Inject runtime + bundled node_modules into NODE_PATH so child Node processes
// resolve sql.js (bundled in bin/app/node_modules) and better-sqlite3 (runtime).
function buildEnvWithRuntime(baseEnv = process.env) {
  const runtimeNm = getRuntimeNodeModules();
  const bundledNm = path.join(__dirname, "..", "app", "node_modules");
  const existing = baseEnv.NODE_PATH || "";
  const NODE_PATH = [runtimeNm, bundledNm, existing].filter(Boolean).join(path.delimiter);
  return { ...baseEnv, NODE_PATH };
}

module.exports = {
  installRuntime,
  isInBackoff,
  buildEnvWithRuntime,
  getRuntimeDir,
  getRuntimeNodeModules,
  summarizeNpmError,
};
