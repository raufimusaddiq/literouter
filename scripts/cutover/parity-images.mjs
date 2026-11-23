import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PARITY } from "../../tests/parity/config.js";
import { startMockUpstream } from "../../tests/parity/mock-upstream.js";
import { loadFixtures, record } from "../../tests/parity/record.mjs";

const repoRoot = path.resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const NODE_SHA = flag("--node-sha", "90ac4b20952622cc42186e3f316d0e093ed425cf");
const BUN_IMAGE = flag("--bun-image", "ghcr.io/raufimusaddiq/literouter-staging:staging-92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc");
const OUT = path.resolve(flag("--out", path.join(repoRoot, "parity-out")));
const ONLY = flag("--only");
const PREFIXES = flag("--prefixes")?.split(",");
const NODE_PORT = Number(flag("--node-port", 21128));
const BUN_PORT = Number(flag("--bun-port", 21129));
const HOST_IP = flag("--host-ip") ?? hostIp();
const KEEP = args.includes("--keep");
const WARM_MS = Number(flag("--warm-ms", 100000));
const NODE_NAME = "p5t2-node";
const BUN_NAME = "p5t2-bun";

function hostIp() {
  const probe = Bun.spawnSync(["docker", "run", "--rm", "--name", "p5t2-probe", "alpine", "sh", "-c", "ip route | awk '/default/ {print $3}'"]);
  const gateway = probe.stdout.toString().trim();
  const ifaces = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
  return ifaces.find((a) => a.startsWith(gateway.split(".").slice(0, 2).join("."))) ?? ifaces[0] ?? gateway;
}

const sh = (cmd, opts = {}) => {
  const r = Bun.spawnSync(cmd, { cwd: repoRoot, ...opts });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const must = (cmd, opts) => {
  const r = sh(cmd, opts);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")} failed (${r.code}):\n${r.err}${r.out}`);
  return r.out;
};
const bash = process.env.BASH_EXE ?? "bash";

function removeContainers() {
  for (const name of [NODE_NAME, BUN_NAME]) sh(["docker", "rm", "-f", name]);
}

async function waitHealthy(url, name) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    const state = sh(["docker", "inspect", "-f", "{{.State.Running}}", name]).out.trim();
    if (state !== "true") throw new Error(`${name} is not running:\n${sh(["docker", "logs", name]).out}${sh(["docker", "logs", name]).err}`);
    await Bun.sleep(400);
  }
  throw new Error(`${name} did not become healthy:\n${sh(["docker", "logs", name]).out}${sh(["docker", "logs", name]).err}`);
}

async function recordInto(baseUrl, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const mock = await startMockUpstream({ port: PARITY.mockPort, outDir, hostname: "0.0.0.0" });
  const wrapped = { requests: mock.requests, url: `http://host.docker.internal:${PARITY.mockPort}`, stop: mock.stop };
  try {
    const { ids, unreachable } = await record({ baseUrl, outDir, mock: wrapped, only: ONLY, fixtures: PREFIXES ? loadFixtures().filter((fx) => PREFIXES.some((p) => fx.id.startsWith(p))) : undefined, log: console.error });
    console.log(`recorded ${ids.length} fixtures from ${baseUrl} into ${outDir}`);
    return { ids, unreachable };
  } finally {
    await mock.stop();
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "p5t2-"));
let code = 1;
process.env.MOCK_STREAM_PAUSE_MS = String(PARITY.slowStreamPauseMs);
try {
  removeContainers();
  const seedDir = path.join(work, "seed");
  const home = path.join(work, "home");
  fs.mkdirSync(path.join(seedDir, "auth"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(seedDir, "machine-id"), PARITY.machineId);
  fs.writeFileSync(path.join(seedDir, "auth", "cli-secret"), PARITY.cliSecret);
  const upstream = `http://host.docker.internal:${PARITY.mockPort}`;
  const seed = must(["bun", "tests/parity/seed.mjs", seedDir, "--upstream", upstream, "--print-key"], { env: { ...process.env, HOME: home, USERPROFILE: home } });
  if (seed.trim().split("\n").pop() !== PARITY.apiKey) throw new Error(`seed printed unexpected key ${seed}`);
  const nodeData = path.join(work, "data-node");
  const bunData = path.join(work, "data-bun");
  fs.cpSync(seedDir, nodeData, { recursive: true });
  fs.cpSync(seedDir, bunData, { recursive: true });

  const envFile = path.join(work, "secrets.env");
  const secrets = (port) =>
    [
      `JWT_SECRET=${PARITY.jwtSecret}`,
      `API_KEY_SECRET=${PARITY.apiKeySecret}`,
      `MACHINE_ID_SALT=${PARITY.machineIdSalt}`,
      `INITIAL_PASSWORD=${PARITY.initialPassword}`,
      `NEXT_PUBLIC_BASE_URL=http://127.0.0.1:${port}`,
      `MOCK_STREAM_PAUSE_MS=${PARITY.slowStreamPauseMs}`,
      "NEXT_TELEMETRY_DISABLED=1",
    ].join("\n") + "\n";
  const nodeEnv = path.join(work, "node.env");
  fs.writeFileSync(nodeEnv, secrets(NODE_PORT));
  fs.writeFileSync(envFile, secrets(BUN_PORT));

  const started = Date.now();
  must([bash, "scripts/cutover/node-baseline.sh", NODE_SHA, String(NODE_PORT), nodeData], {
    env: { ...process.env, CONTAINER_NAME: NODE_NAME, ENV_FILE: nodeEnv, UPSTREAM_HOST_IP: HOST_IP, TZ: PARITY.tz, MSYS_NO_PATHCONV: "1" },
  });
  must([
    "docker", "run", "-d", "--name", BUN_NAME, "--memory", "768m",
    "-p", `127.0.0.1:${BUN_PORT}:20128`,
    "-v", `${bunData}:/app/data`,
    "--add-host", `host.docker.internal:${HOST_IP}`,
    "--env-file", envFile,
    "-e", "DATA_DIR=/app/data", "-e", "PORT=20128", "-e", "HOSTNAME=0.0.0.0", "-e", "NODE_ENV=production",
    "-e", `TZ=${PARITY.tz}`, "-e", "LOG_LEVEL=WARN", "-e", "ENABLE_REQUEST_LOGS=true",
    "-e", "OBSERVABILITY_MAX_RECORDS=15000", "-e", "REQUEST_LOG_MAX_SIZE_MB=500", "-e", "REQUEST_LOG_MAX_SESSIONS=1000",
    "-e", "MODEL_CATALOG_SYNC=off", "-e", "DISABLE_BACKGROUND_TOKEN_REFRESH=true", "-e", "MINIMAL_PROFILE=true",
    BUN_IMAGE,
  ]);

  const nodeUrl = `http://127.0.0.1:${NODE_PORT}`;
  const bunUrl = `http://127.0.0.1:${BUN_PORT}`;
  await Promise.all([waitHealthy(nodeUrl, NODE_NAME), waitHealthy(bunUrl, BUN_NAME)]);
  await Bun.sleep(Math.max(0, WARM_MS - (Date.now() - started)));

  const baselineOut = path.join(OUT, "baseline");
  const bunOut = path.join(OUT, "bun");
  const a = await recordInto(nodeUrl, baselineOut);
  const b = await recordInto(bunUrl, bunOut);
  for (const [label, r] of [["baseline", a], ["bun", b]]) if (r.unreachable.length) console.error(`${label}: no response for ${r.unreachable.join(", ")}`);

  const none = path.join(work, "none.json");
  fs.writeFileSync(none, "[]");
  const compare = sh(["bun", "tests/parity/compare.mjs", baselineOut, bunOut, "--known", none]);
  process.stdout.write(compare.out);
  process.stderr.write(compare.err);
  const upstreamCmp = sh(["bun", "tests/parity/compare-upstream.mjs", baselineOut, bunOut, "--known", none]);
  process.stdout.write(upstreamCmp.out);
  process.stderr.write(upstreamCmp.err);
  fs.writeFileSync(path.join(OUT, "compare.log"), `${compare.out}${compare.err}\n--- upstream ---\n${upstreamCmp.out}${upstreamCmp.err}`);
  console.log(`compare exit ${compare.code}, compare-upstream exit ${upstreamCmp.code}`);
  code = compare.code === 0 && upstreamCmp.code === 0 ? 0 : 1;
} catch (e) {
  console.error(e.message ?? e);
} finally {
  if (!KEEP) removeContainers();
  if (!KEEP) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(code);
