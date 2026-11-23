import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY } from "./config.js";
import { startMockUpstream } from "./mock-upstream.js";
import { record } from "./record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const target = flag("--target");
const outArg = flag("--out");
const only = flag("--only");
if (target !== "bun" || !outArg) {
  console.error("usage: bun tests/parity/run.mjs --target bun --out <dir> [--only <fixture-id-prefix>]");
  process.exit(2);
}
const outDir = path.resolve(outArg);

const MAX_UNREACHABLE = 3;
const stale = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f !== "upstream-requests.jsonl" && f !== "upstream-fixtures.jsonl" && !f.endsWith(".json")) : [];
if (stale.length) {
  console.error(`refusing to clear ${outDir}: it holds files that are not parity output (${stale.slice(0, 3).join(", ")})`);
  process.exit(2);
}
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true });

const freePort = () => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const p = s.port;
  s.stop(true);
  return p;
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "parity-run-"));
const dataDir = path.join(work, "data");
const home = path.join(work, "home");
fs.mkdirSync(path.join(dataDir, "auth"), { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(dataDir, "machine-id"), PARITY.machineId);
fs.writeFileSync(path.join(dataDir, "auth", "cli-secret"), PARITY.cliSecret);

process.env.MOCK_STREAM_PAUSE_MS = String(PARITY.slowStreamPauseMs);
const mock = await startMockUpstream({ port: PARITY.mockPort, outDir });

let child;
let code = 1;
const stopChild = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([child.exited, Bun.sleep(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
};
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await stopChild();
    await mock.stop();
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    process.exit(130);
  });
}
try {
  const seed = Bun.spawnSync(["bun", path.join(repoRoot, "tests/parity/seed.mjs"), dataDir, "--upstream", mock.url, "--print-key"], { cwd: repoRoot, env: { ...process.env, HOME: home, USERPROFILE: home } });
  if (seed.exitCode !== 0) throw new Error(`seed failed: ${seed.stderr.toString()}${seed.stdout.toString()}`);
  const printed = seed.stdout.toString().trim().split("\n").pop();
  if (printed !== PARITY.apiKey) throw new Error(`seed printed unexpected key ${printed}`);

  const port = freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const command = ["bun", path.join(repoRoot, "src/server/index.js")];
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
    NODE_ENV: "production",
    NEXT_PUBLIC_BASE_URL: baseUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    JWT_SECRET: PARITY.jwtSecret,
    API_KEY_SECRET: PARITY.apiKeySecret,
    MACHINE_ID_SALT: PARITY.machineIdSalt,
    INITIAL_PASSWORD: PARITY.initialPassword,
    TZ: PARITY.tz,
    MOCK_STREAM_PAUSE_MS: String(PARITY.slowStreamPauseMs),
  };
  for (const k of ["TRUST_LOOPBACK_AS_LOCAL", "TRUST_PROXY", "REQUIRE_API_KEY", "MINIMAL_PROFILE", "AUTH_COOKIE_SECURE", "API_KEY_FAIL_LIMIT"]) delete env[k];
  child = Bun.spawn(command, { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const serverLog = [];
  for (const stream of [child.stdout, child.stderr]) {
    (async () => {
      for await (const chunk of stream) serverLog.push(Buffer.from(chunk).toString());
    })();
  }

  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    if (child.exitCode !== null) throw new Error(`target exited early:\n${serverLog.join("")}`);
    try {
      ready = (await fetch(`${baseUrl}/api/health`)).ok;
    } catch {
      await Bun.sleep(200);
    }
  }
  if (!ready) throw new Error(`target did not become healthy:\n${serverLog.join("")}`);

  const { ids, unreachable } = await record({ baseUrl, outDir, mock, only, dataDir, log: console.error });
  console.log(`recorded ${ids.length} fixtures into ${outDir}`);
  if (child.exitCode !== null) throw new Error(`target exited during recording (code ${child.exitCode}):
${serverLog.join("")}`);
  if (unreachable.length > MAX_UNREACHABLE) throw new Error(`${unreachable.length} fixtures got no response (limit ${MAX_UNREACHABLE}): ${unreachable.join(", ")}`);
  code = 0;
} catch (e) {
  console.error(e.message ?? e);
} finally {
  await stopChild();
  await mock.stop();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
process.exit(code);
