import { Database } from "bun:sqlite";
import { cpSync, existsSync, readlinkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const SCENARIOS = ["start-stop", "update-while-running", "replace-old-node-server"];
const BASE_PORT = 20190;
const PASSWORD = "p5t6-pass";
const HEALTH_DEADLINE_MS = 90_000;
const IS_WIN = process.platform === "win32";
const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const MIN_PORT = BASE_PORT;

const failures = [];

const USAGE = [
  "usage: bun scripts/cutover/cli-smoke.mjs <start-stop|update-while-running|replace-old-node-server>",
  "  [--spec <tarball|literouter@x.y.z>] [--spec-b <spec>] [--method add-g|bunx] [--port <n>=20190+]",
  "  [--legacy-src <package dir> | --legacy-modules <dir holding 9router>] [--legacy-runtime <old runtime binary>]",
  "  [--legacy-version <v>] [--legacy-pidfile] [--skip-seed] [--expect takeover|refuse|either] [--keep]",
  "",
  "The old CLI is installed and run by the caller: the runner never names the old runtime or its package manager.",
  "OLD_PM is the package manager the old CLI was installed with, OLD_RT its runtime binary, T a scratch dir.",
  "",
  "Fork variant (origin/main CLI, writes server.pid; the app comes from the prebuilt upstream package):",
  "  mkdir -p $T/forksrc $T/fork && git archive origin/main cli | tar -x -C $T/forksrc",
  "  OLD_PM i --prefix $T/up --ignore-scripts 9router@0.5.81",
  "  cp -r $T/up/node_modules/9router/. $T/fork/ && cp $T/forksrc/cli/cli.js $T/fork/cli.js",
  "  rm -rf $T/fork/src $T/fork/hooks && cp -r $T/forksrc/cli/src $T/forksrc/cli/hooks $T/fork/",
  "  (cd $T/fork && OLD_PM install --omit=dev --ignore-scripts)",
  "  bun scripts/cutover/cli-smoke.mjs replace-old-node-server --legacy-src $T/fork --legacy-runtime $OLD_RT --legacy-version 0.5.81",
  "",
  "Upstream variant (no pidfile; takeover or a clear refusal must both leave one server on the data dir):",
  "  bun scripts/cutover/cli-smoke.mjs replace-old-node-server --legacy-modules $T/up/node_modules --legacy-runtime $OLD_RT --expect either",
  "",
  "On Linux the old package's runtime warm-up needs its package manager on PATH; --skip-seed skips the API-key steps.",
].join("\n");

function report(ok, step, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${step}${detail ? ` - ${detail}` : ""}`;
  console.log(line);
  if (!ok) failures.push(line);
  return ok;
}

function info(step, detail) {
  console.log(`INFO ${step} - ${detail}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function parseArgs(argv) {
  const opts = { method: "add-g", keep: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--spec") opts.spec = argv[++i];
    else if (arg === "--spec-b") opts.specB = argv[++i];
    else if (arg === "--method") opts.method = argv[++i];
    else if (arg === "--port") opts.port = parseInt(argv[++i], 10);
    else if (arg === "--legacy-modules") opts.legacyModules = argv[++i];
    else if (arg === "--skip-seed") opts.skipSeed = true;
    else if (arg === "--expect") opts.expect = argv[++i];
    else if (arg === "--legacy-runtime-seed") opts.legacyRuntimeSeed = argv[++i];
    else if (arg === "--legacy-src") opts.legacySrc = argv[++i];
    else if (arg === "--legacy-version") opts.legacyVersion = argv[++i];
    else if (arg === "--legacy-runtime") opts.legacyRuntime = argv[++i];
    else if (arg === "--keep") opts.keep = true;
    else if (arg === "--legacy-pidfile") opts.legacyPidfile = true;
    else rest.push(arg);
  }
  opts.scenario = rest[0];
  return opts;
}

function buildEnv(ctx, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() !== "PATH") env[key] = value;
  }
  const basePath = process.env.PATH ?? process.env.Path ?? "";
  const sep = IS_WIN ? ";" : ":";
  env.PATH = [join(ctx.root, "bun", "bin"), basePath].join(sep);
  env.BUN_INSTALL = join(ctx.root, "bun");
  env.BUN_INSTALL_BIN = join(ctx.root, "bun", "bin");
  env.BUN_INSTALL_GLOBAL_DIR = join(ctx.root, "bun", "install", "global");
  env.BUN_INSTALL_CACHE_DIR = join(ctx.root, "bun", "install", "cache");
  env.DATA_DIR = ctx.dataDir;
  env.INITIAL_PASSWORD = PASSWORD;
  env.APPDATA = join(ctx.root, "appdata");
  env.HOME = join(ctx.root, "home");
  env.P5ROOT = ctx.root;
  env.TEMP = join(ctx.root, "tmp");
  env.TMP = env.TEMP;
  env.TMPDIR = env.TEMP;
  delete env.NINEROUTER_REUSE_PID;
  return { ...env, ...extra };
}

async function run(cmd, ctx, { cwd, env, timeoutMs = 300_000 } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: env ?? buildEnv(ctx),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, out: `${out}${err}` };
}

function tail(text, lines = 12) {
  return text.trim().split(/\r?\n/).slice(-lines).join(" | ");
}

function procTable() {
  const rows = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync("/proc/" + name + "/stat", "utf8");
      const ppid = parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);
      const cmd = readFileSync("/proc/" + name + "/cmdline", "utf8").split(String.fromCharCode(0)).join(" ").trim();
      rows.push({ pid: +name, ppid, name: "", cmd });
    } catch {}
  }
  return rows;
}

function procListener(port) {
  const wanted = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = readFileSync(table, "utf8");
    } catch {}
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 9 && cols[3] === "0A" && cols[1].slice(cols[1].lastIndexOf(":") + 1).toUpperCase() === wanted) inodes.add("socket:[" + cols[9] + "]");
    }
  }
  if (inodes.size === 0) return null;
  for (const row of procTable().sort((a, b) => a.pid - b.pid)) {
    try {
      for (const fd of readdirSync("/proc/" + row.pid + "/fd")) {
        try {
          if (inodes.has(readlinkSync("/proc/" + row.pid + "/fd/" + fd))) return row.pid;
        } catch {}
      }
    } catch {}
  }
  return null;
}

async function listOwned(ctx) {
  if (IS_WIN) {
    const script =
      "$r=$env:P5ROOT; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID -and $_.CommandLine.IndexOf($r,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)\" }";
    const res = await run(["powershell", "-NoProfile", "-Command", script], ctx, { timeoutMs: 60_000 });
    return res.out
      .split(/\r?\n/)
      .map((line) => line.match(/^(\d+)\|(\d+)\|([^|]*)\|(.*)$/))
      .filter(Boolean)
      .map((m) => ({ pid: +m[1], ppid: +m[2], name: m[3], cmd: m[4] }));
  }
  let all;
  if (process.platform === "linux") {
    all = procTable().filter((p) => p.pid !== process.pid);
  } else {
    const res = await run(["ps", "-eo", "pid=,ppid=,args="], ctx, { timeoutMs: 30_000 });
    all = res.out
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m) => m && +m[1] !== process.pid)
      .map((m) => ({ pid: +m[1], ppid: +m[2], name: "", cmd: m[3] }));
  }
  const owned = new Map(all.filter((p) => p.cmd.includes(ctx.root) && !/^ps /.test(p.cmd)).map((p) => [p.pid, p]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const proc of all) {
      if (!owned.has(proc.pid) && owned.has(proc.ppid) && !/^ps /.test(proc.cmd)) {
        owned.set(proc.pid, proc);
        grew = true;
      }
    }
  }
  return [...owned.values()];
}

async function trayProcs(ctx) {
  const owned = await listOwned(ctx);
  return owned.filter((p) => /tray\.ps1|systray/i.test(p.cmd));
}

function under(root, candidate) {
  const norm = (value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(candidate) === norm(root) || norm(candidate).startsWith(norm(root) + "/");
}

async function assertIsolation(ctx) {
  const bin = (await run([process.execPath, "pm", "bin", "-g"], ctx, { timeoutMs: 60_000 })).out.trim().split(/\r?\n/).pop();
  const listing = (await run([process.execPath, "pm", "ls", "-g"], ctx, { timeoutMs: 60_000 })).out.trim().split(/\r?\n/)[0] ?? "";
  const globalDir = listing.includes(" node_modules") ? listing.slice(0, listing.indexOf(" node_modules")) : listing;
  const ok = under(ctx.root, bin) && under(ctx.root, globalDir);
  if (!report(ok, "isolation: bun global dirs resolve under the throwaway root", `bin=${bin} global=${globalDir} root=${ctx.root}`)) {
    throw new Error("global install dirs escape the throwaway root; aborting before any install");
  }
}

async function killOwned(ctx) {
  for (let round = 0; round < 3; round++) {
    const owned = await listOwned(ctx);
    if (owned.length === 0) return 0;
    for (const proc of owned) {
      try {
        process.kill(proc.pid);
      } catch {}
    }
    await sleep(500);
  }
  return (await listOwned(ctx)).length;
}

async function portOpen(port) {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open() {}, close() {}, error() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function listenerPid(ctx, port) {
  if (IS_WIN) {
    const res = await run(["netstat", "-ano", "-p", "TCP"], ctx, { timeoutMs: 30_000 });
    for (const line of res.out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? "";
      if (parseInt(local.slice(local.lastIndexOf(":") + 1), 10) === port) return parseInt(cols[cols.length - 1], 10);
    }
    return null;
  }
  if (process.platform === "linux") return procListener(port);
  const res = await run(["lsof", "-tiTCP:" + port, "-sTCP:LISTEN"], ctx, { timeoutMs: 15_000 });
  const line = res.out.split(/\r?\n/).find((l) => /^\d+$/.test(l.trim()));
  return line ? parseInt(line, 10) : null;
}

async function waitHealth(base, launcher, deadlineMs = HEALTH_DEADLINE_MS) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return 200;
    } catch {}
    if (launcher && launcher.exitCode !== null && launcher.exitCode !== undefined) return `launcher-exited-${launcher.exitCode}`;
    await sleep(500);
  }
  return "timeout";
}

function pidfilePath(ctx) {
  return join(ctx.dataDir, "server.pid");
}

function readPidfile(ctx) {
  try {
    return JSON.parse(readFileSync(pidfilePath(ctx), "utf8"));
  } catch {
    return null;
  }
}

function dbVersion(ctx) {
  const file = join(ctx.dataDir, "db", "data.sqlite");
  if (!existsSync(file)) return null;
  const db = new Database(file, { readonly: true });
  try {
    return db.query("SELECT value FROM _meta WHERE key = 'appVersion'").get()?.value ?? null;
  } finally {
    db.close();
  }
}

function packageVersion(file) {
  return JSON.parse(readFileSync(file, "utf8")).version;
}

async function packTarball(ctx, cliDir, label) {
  const out = join(ctx.root, "tarballs", label);
  mkdirSync(out, { recursive: true });
  const built = await run([process.execPath, "run", "build"], ctx, { cwd: cliDir });
  if (built.code !== 0) throw new Error(`cli build failed: ${tail(built.out)}`);
  const packed = await run([process.execPath, "pm", "pack", "--destination", out], ctx, { cwd: cliDir });
  if (packed.code !== 0) throw new Error(`bun pm pack failed: ${tail(packed.out)}`);
  const file = readdirSync(out).find((name) => name.endsWith(".tgz"));
  if (!file) throw new Error(`no tarball produced in ${out}`);
  return join(out, file);
}

async function packBumped(ctx) {
  const copy = join(ctx.root, "tree-b");
  const skip = new Set(["node_modules", ".git", "dist", ".superpowers", ".claude"]);
  cpSync(REPO_ROOT, copy, {
    recursive: true,
    filter: (src) => {
      const norm = src.replace(/\\/g, "/");
      return !skip.has(basename(src)) && !norm.endsWith("/cli/app") && !norm.includes("/.claude/worktrees");
    },
  });
  const cliPkgPath = join(copy, "cli", "package.json");
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8"));
  const parts = cliPkg.version.split(".").map(Number);
  parts[2] += 1;
  cliPkg.version = parts.join(".");
  writeFileSync(cliPkgPath, `${JSON.stringify(cliPkg, null, 2)}\n`);
  for (const dir of [copy, join(copy, "cli")]) {
    const res = await run([process.execPath, "install", "--frozen-lockfile"], ctx, { cwd: dir });
    if (res.code !== 0) throw new Error(`bun install in ${dir} failed: ${tail(res.out)}`);
  }
  const tarball = await packTarball(ctx, join(copy, "cli"), "b");
  return { tarball, version: cliPkg.version };
}

function specVersion(spec) {
  return String(spec).match(/(?:@|literouter-)(\d+\.\d+\.\d+)(?:\.tgz)?$/)?.[1] ?? null;
}

function cliCommand(ctx, spec) {
  if (ctx.method === "bunx") return [process.execPath, "x", "--package", spec, "literouter"];
  const bin = Bun.which("literouter", { PATH: buildEnv(ctx).PATH });
  if (!bin) throw new Error("literouter is not on the throwaway PATH");
  return [bin];
}

async function install(ctx, spec) {
  if (!ctx.isolationChecked) {
    await assertIsolation(ctx);
    ctx.isolationChecked = true;
  }
  if (ctx.method === "bunx") {
    const res = await run([...cliCommand(ctx, spec), "--version"], ctx);
    return { code: res.code, out: res.out };
  }
  return run([process.execPath, "add", "-g", spec], ctx);
}

function startCli(ctx, spec, name) {
  const cmd = [...cliCommand(ctx, spec), "--port", String(ctx.port), "--host", "127.0.0.1", "--no-browser", "--skip-update"];
  const logFile = join(ctx.root, "logs", `${name}.log`);
  mkdirSync(dirname(logFile), { recursive: true });
  const proc = Bun.spawn(cmd, {
    env: buildEnv(ctx),
    stdin: "ignore",
    stdout: Bun.file(logFile),
    stderr: Bun.file(logFile),
    windowsHide: true,
  });
  return { proc, logFile };
}

function readLog(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

async function stopCli(ctx, spec) {
  const res = await run([...cliCommand(ctx, spec), "stop"], ctx, { timeoutMs: 60_000 });
  return res;
}

async function checkStop(ctx, spec, label, launcher, serverPidBefore) {
  const res = await stopCli(ctx, spec);
  report(res.code === 0, `${label}: stop exits 0`, `exit=${res.code} ${tail(res.out, 3)}`);
  await sleep(1500);
  report(!(await portOpen(ctx.port)), `${label}: port ${ctx.port} closed after stop`);
  report(!existsSync(pidfilePath(ctx)), `${label}: pidfile removed`);
  if (launcher) {
    const gone = await waitExit(launcher.proc, 10_000);
    report(gone, `${label}: launcher process exited`);
  }
  if (serverPidBefore) {
    report(!pidAlive(serverPidBefore), `${label}: server pid ${serverPidBefore} gone`);
  }
}

function pidAlive(pid) {
  try {
    if (process.platform === "linux") {
      const state = readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "")[0];
      return state !== "Z";
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitExit(proc, ms) {
  const timer = sleep(ms).then(() => false);
  return Promise.race([proc.exited.then(() => true), timer]);
}

async function startAndCheck(ctx, spec, label, name) {
  const launcher = startCli(ctx, spec, name);
  const health = await waitHealth(`http://127.0.0.1:${ctx.port}`, launcher.proc);
  const ok = report(health === 200, `${label}: /api/health 200`, health === 200 ? "" : `${health}; log: ${tail(readLog(launcher.logFile))}`);
  return { launcher, ok };
}

async function checkPidfile(ctx, label) {
  const record = readPidfile(ctx);
  report(!!record && Number.isInteger(record.pid) && Number.isInteger(record.launcherPid), `${label}: pidfile has pid and launcherPid`, JSON.stringify(record));
  const listener = await listenerPid(ctx, ctx.port);
  report(!!record && listener === record.pid, `${label}: pidfile pid owns the listening port`, `listener=${listener} record=${record?.pid}`);
  return record;
}

async function reportTray(ctx, label) {
  let procs = [];
  for (let i = 0; i < 20 && procs.length === 0; i++) {
    procs = await trayProcs(ctx);
    if (procs.length === 0) await sleep(500);
  }
  info(`${label}: tray helper started`, procs.length > 0 ? `yes (pid ${procs.map((p) => p.pid).join(",")})` : "no");
  return procs.length > 0;
}

async function scenarioStartStop(ctx, spec) {
  const inst = await install(ctx, spec);
  if (!report(inst.code === 0, "start-stop: install", `${ctx.method} exit=${inst.code} ${tail(inst.out, 4)}`)) return;
  const { launcher, ok } = await startAndCheck(ctx, spec, "start-stop", "start");
  if (!ok) return;
  const record = await checkPidfile(ctx, "start-stop");
  await reportTray(ctx, "start-stop");
  await checkStop(ctx, spec, "start-stop", launcher, record?.pid);
  const trayLeft = (await trayProcs(ctx)).length;
  info("start-stop: tray helper stopped", trayLeft === 0 ? "yes" : `no (${trayLeft} left)`);
}

async function scenarioUpdate(ctx, specA, specB, versionA, versionB) {
  const inst = await install(ctx, specA);
  if (!report(inst.code === 0, "update-while-running: install A", `${ctx.method} exit=${inst.code} ${tail(inst.out, 4)}`)) return;
  const { launcher, ok } = await startAndCheck(ctx, specA, "update-while-running", "start-a");
  if (!ok) return;
  const record = await checkPidfile(ctx, "update-while-running");
  const seenA = dbVersion(ctx);
  report(seenA === versionA, "update-while-running: server A reports its version", `db appVersion=${seenA} expected=${versionA}`);

  const upd = await install(ctx, specB);
  const busy = /EBUSY|EPERM/i.test(upd.out);
  report(upd.code === 0 && !busy, "update-while-running: install B while A runs", `exit=${upd.code} busyOrPerm=${busy} ${tail(upd.out, 4)}`);
  if (ctx.method === "add-g") {
    const installed = packageVersion(join(ctx.root, "bun", "install", "global", "node_modules", "literouter", "package.json"));
    report(installed === versionB, "update-while-running: installed package is version B", `installed=${installed}`);
  }
  const stillUp = await waitHealth(`http://127.0.0.1:${ctx.port}`, null, 10_000);
  info("update-while-running: server A still answers after update", String(stillUp === 200));

  await checkStop(ctx, specB, "update-while-running", launcher, record?.pid);
  const second = await startAndCheck(ctx, specB, "update-while-running: restart on B", "start-b");
  if (!second.ok) return;
  const seenB = dbVersion(ctx);
  report(seenB === versionB, "update-while-running: restart serves version B", `db appVersion=${seenB} expected=${versionB}`);
  const record2 = readPidfile(ctx);
  await checkStop(ctx, specB, "update-while-running: final", second.launcher, record2?.pid);
}

async function apiLogin(base) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function seedKey(base) {
  const cookie = await apiLogin(base);
  const res = await fetch(`${base}/api/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "p5t6-seed" }),
  });
  if (res.status >= 300) throw new Error(`create key -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).key;
}

async function seedKeyWhenReady(base, deadlineMs = 240_000) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await seedKey(base);
    } catch (err) {
      if (Date.now() > end) throw err;
      await sleep(3000);
    }
  }
}

async function keySurvives(base, key) {
  const cookie = await apiLogin(base);
  const res = await fetch(`${base}/api/keys`, { headers: { cookie } });
  if (res.status !== 200) throw new Error(`list keys -> ${res.status}`);
  const keys = (await res.json()).keys ?? [];
  return keys.some((k) => k.key === key);
}

async function scenarioReplace(ctx, spec, opts) {
  const label = "replace-old-node-server";
  const source = opts.legacySrc ?? null;
  if ((!opts.legacyModules && !source) || !opts.legacyRuntime) {
    report(false, `${label}: prerequisites`, "needs --legacy-src <package dir> or --legacy-modules <dir holding 9router>, plus --legacy-runtime <old runtime>");
    return;
  }
  const modules = join(ctx.root, "legacy", "node_modules");
  if (source) cpSync(source, join(modules, "9router"), { recursive: true });
  else cpSync(opts.legacyModules, modules, { recursive: true });
  const legacyCli = join(modules, "9router", "cli.js");
  const legacyVersion = existsSync(legacyCli) ? packageVersion(join(modules, "9router", "package.json")) : null;
  const versionOk = legacyVersion !== null && (!opts.legacyVersion || legacyVersion === opts.legacyVersion);
  if (!report(versionOk, `${label}: old package present`, `version=${legacyVersion} expected=${opts.legacyVersion ?? "any"} source=${source ?? opts.legacyModules}`)) return;

  if (opts.legacyRuntimeSeed) cpSync(opts.legacyRuntimeSeed, join(ctx.dataDir, "runtime"), { recursive: true });
  const warm = await run([opts.legacyRuntime, join(modules, "9router", "hooks", "postinstall.js")], ctx, { timeoutMs: 180_000 });
  info(`${label}: old package runtime warm-up (its own postinstall, throwaway DATA_DIR)`, `exit=${warm.code} ${tail(warm.out, 2)}`);
  const logFile = join(ctx.root, "logs", "legacy.log");
  mkdirSync(dirname(logFile), { recursive: true });
  const old = Bun.spawn([opts.legacyRuntime, legacyCli, "--port", String(ctx.port), "--no-browser", "--skip-update"], {
    env: buildEnv(ctx),
    stdin: "ignore",
    stdout: Bun.file(logFile),
    stderr: Bun.file(logFile),
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${ctx.port}`;
  const health = await waitHealth(base, old);
  if (!report(health === 200, `${label}: old server /api/health 200`, health === 200 ? "" : `${health}; log: ${tail(readLog(logFile))}`)) return;
  let oldListener = await listenerPid(ctx, ctx.port);
  if (oldListener === null) {
    const child = (await listOwned(ctx)).find((p) => p.ppid === old.pid);
    oldListener = child?.pid ?? null;
    info(`${label}: port owner not found by the listener query, using the launcher's child`, `${oldListener} (${child?.cmd ?? "none"})`);
  }
  if (!report(oldListener !== null, `${label}: old server pid identified`, String(oldListener))) return;
  const oldPidfile = readPidfile(ctx);
  info(`${label}: pidfile written by old CLI`, JSON.stringify(oldPidfile));
  if (opts.legacyPidfile && oldListener !== null) {
    writeFileSync(pidfilePath(ctx), JSON.stringify({ pid: oldListener, port: ctx.port, startedAt: Date.now() }));
    info(`${label}: wrote the pidfile the fork's old CLI wrote`, pidfilePath(ctx));
  }

  let key;
  if (opts.skipSeed) info(`${label}: key seeding skipped`, "--skip-seed");
  else try {
    key = await seedKeyWhenReady(base);
    report(!!key, `${label}: seeded an API key on the old server`);
  } catch (err) {
    report(false, `${label}: seeded an API key on the old server`, String(err.message));
    return;
  }

  const inst = await install(ctx, spec);
  if (!report(inst.code === 0, `${label}: install new CLI`, `${ctx.method} exit=${inst.code} ${tail(inst.out, 4)}`)) return;
  const launcher = startCli(ctx, spec, "new");
  for (let i = 0; i < 120 && !readPidfile(ctx)?.launcherPid && launcher.proc.exitCode === null; i++) await sleep(500);
  const exited = launcher.proc.exitCode !== null;
  const newLog = readLog(launcher.logFile);
  const refused = exited && launcher.proc.exitCode !== 0 && /will not start a second server on the same data directory/i.test(newLog);
  const expect = opts.expect ?? "takeover";

  if (refused) {
    const oldAlive = pidAlive(oldListener);
    const secondServer = readPidfile(ctx)?.launcherPid !== undefined;
    report(expect !== "takeover", `${label}: outcome is a refusal`, `expected=${expect}; exit=${launcher.proc.exitCode}; log: ${tail(newLog, 4)}`);
    report(oldAlive && !secondServer, `${label}: refusal left only the old server on the data dir`, `old alive=${oldAlive} newPidfile=${secondServer}`);
    report(/stop it yourself/i.test(newLog), `${label}: refusal message tells the user how to stop the old server`);
    report((await listenerPid(ctx, ctx.port)) === oldListener, `${label}: old server still owns the port`);
    const left = await killOwned(ctx);
    info(`${label}: stopped the old server the runner started`, `left=${left}`);
    return;
  }

  report(expect !== "refuse", `${label}: outcome is a takeover`, `expected=${expect}`);
  const newPort = readPidfile(ctx)?.port ?? ctx.port;
  const ready = await waitHealth(`http://127.0.0.1:${newPort}`, launcher.proc, 60_000);
  info(`${label}: new server port`, `${newPort} (requested ${ctx.port})`);
  const oldAlive = pidAlive(oldListener);
  const listener = await listenerPid(ctx, ctx.port);
  report(!oldAlive, `${label}: old server stopped first`, `old pid ${oldListener} alive=${oldAlive}; listener now=${listener}; new log: ${tail(newLog, 6)}`);
  const newOwnsPort = ready === 200 && newPort === ctx.port && listener !== null && listener !== oldListener;
  report(newOwnsPort, `${label}: new server answers /api/health on the same port`, `health=${ready} listener=${listener} port=${newPort}`);
  const record = readPidfile(ctx);
  info(`${label}: new pidfile`, JSON.stringify(record));

  const probePort = record?.port ?? newPort;
  const probeListener = await listenerPid(ctx, probePort);
  const probeIsNew = ready === 200 && !!record && probeListener !== null && probeListener !== oldListener && !oldAlive;
  if (opts.skipSeed) info(`${label}: key survival skipped`, `new server up in place of the old one=${probeIsNew}`);
  else if (report(probeIsNew, `${label}: probe target is the new server`, `port=${probePort} listener=${probeListener} oldListener=${oldListener}`)) {
    try {
      report(await keySurvives(`http://127.0.0.1:${probePort}`, key), `${label}: seeded API key survived`, `port ${probePort}`);
    } catch (err) {
      report(false, `${label}: seeded API key survived`, String(err.message));
    }
  } else {
    report(false, `${label}: seeded API key survived`, "not checked: the new server is not up in place of the old one");
  }

  if (record && record.port && record.port !== ctx.port) ctx.port = record.port;
  ctx.extraPorts.add(newPort);
  await checkStop(ctx, spec, label, launcher, record?.pid);
}

async function settle(ctx, ms = 8000) {
  const end = Date.now() + ms;
  let owned = await listOwned(ctx);
  while (owned.length > 0 && Date.now() < end) {
    await sleep(500);
    owned = await listOwned(ctx);
  }
  return owned;
}

async function finalChecks(ctx, label) {
  const survivors = await settle(ctx);
  const openPorts = [];
  for (const port of [ctx.port, ...ctx.extraPorts]) if (await portOpen(port)) openPorts.push(port);
  report(survivors.length === 0, `${label}: no processes left from the throwaway run`, `left=${survivors.length} ${survivors.map((p) => `${p.pid}:${p.cmd.slice(0, 80)}`).join(" ; ")}`);
  report(openPorts.length === 0, `${label}: ports free at exit`, `open=${openPorts.join(",") || "none"}`);
  await killOwned(ctx);
}

async function removeRoot(ctx, opts) {
  if (opts.keep) return;
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(ctx.root, { recursive: true, force: true });
      return;
    } catch {
      await sleep(500);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!SCENARIOS.includes(opts.scenario) || !["add-g", "bunx"].includes(opts.method) || !["takeover", "refuse", "either", undefined].includes(opts.expect)) {
    console.error(USAGE);
    process.exit(2);
  }
  const port = opts.port ?? BASE_PORT + SCENARIOS.indexOf(opts.scenario);
  if (!Number.isInteger(port) || port < MIN_PORT || port > 65535) {
    console.error(`refusing port ${port}: the runner only uses ports ${MIN_PORT}-65535 (never 20128)`);
    process.exit(2);
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p5t6-")));
  const ctx = {
    root,
    dataDir: join(root, "data"),
    port,
    method: opts.method,
    extraPorts: new Set(),
  };
  for (const dir of [ctx.dataDir, join(root, "appdata"), join(root, "home"), join(root, "bun"), join(root, "tmp")]) mkdirSync(dir, { recursive: true });
  info("runner", `${process.platform} bun ${Bun.version} root=${root} port=${ctx.port} method=${ctx.method}`);

  let interrupted = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (interrupted) return;
      interrupted = true;
      console.log(`INFO runner - ${signal}: tearing down the throwaway run`);
      await killOwned(ctx);
      await removeRoot(ctx, opts);
      process.exit(130);
    });
  }

  try {
    const cliDir = join(REPO_ROOT, "cli");
    const specA = opts.spec ?? (await packTarball(ctx, cliDir, "a"));
    const versionA = specVersion(specA) ?? (opts.spec ? null : packageVersion(join(cliDir, "package.json")));
    info("spec A", `${specA} version=${versionA}`);

    if (opts.scenario === "start-stop") await scenarioStartStop(ctx, specA);
    else if (opts.scenario === "replace-old-node-server") await scenarioReplace(ctx, specA, opts);
    else {
      let specB = opts.specB;
      let versionB = null;
      if (!specB) {
        const bumped = await packBumped(ctx);
        specB = bumped.tarball;
        versionB = bumped.version;
      } else {
        versionB = specVersion(specB);
      }
      info("spec B", `${specB} version=${versionB}`);
      if (!report(!!versionB && versionB !== versionA, "update-while-running: version B differs from version A", `A=${versionA} B=${versionB}`)) throw new Error("spec B must carry a different version than spec A");
      await scenarioUpdate(ctx, specA, specB, versionA, versionB);
    }
  } catch (err) {
    report(false, `${opts.scenario}: runner error`, String(err?.stack ?? err));
  } finally {
    await finalChecks(ctx, opts.scenario);
    await removeRoot(ctx, opts);
  }
  console.log(failures.length === 0 ? `RESULT PASS ${opts.scenario} (${ctx.method})` : `RESULT FAIL ${opts.scenario} (${ctx.method}): ${failures.length} failed step(s)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
