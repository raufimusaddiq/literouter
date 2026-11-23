import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:20128";
const DEFAULT_TIMEOUT_S = 120;
const HEALTH_JS = `fetch('${BASE}/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))`;
const SMOKE_SCRIPT = resolve(import.meta.dir, "smoke-server.mjs");

function docker(args, { allowFail = false } = {}) {
  const run = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString();
  if (run.exitCode !== 0 && !allowFail) {
    throw new Error(`docker ${args.slice(0, 2).join(" ")} failed (${run.exitCode}): ${run.stderr.toString().trim() || out.trim()}`);
  }
  return { code: run.exitCode, out, err: run.stderr.toString() };
}

export function containerName() {
  return `p4w-smoke-${randomBytes(4).toString("hex")}`;
}

export function serverPid(psOutput) {
  const lines = psOutput.split("\n").map((line) => line.trim()).filter(Boolean);
  const server = lines.find((line) => /^\d+\s+\/app\/literouter(\s|$)/.test(line));
  if (!server) throw new Error(`server process not found in ps output: ${psOutput}`);
  return Number(server.split(/\s+/)[0]);
}

export function assertLiterouterUid(uid) {
  if (String(uid).trim() !== "1000") throw new Error(`server runs as uid ${String(uid).trim()}, expected literouter (1000)`);
  return 1000;
}

async function waitForHealth(name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "-f", "{{.State.Running}}", name], { allowFail: true });
    if (state.out.trim() !== "true") {
      throw new Error(`container exited early:\n${docker(["logs", name], { allowFail: true }).out}`);
    }
    const probe = docker(["exec", "-e", "BUN_BE_BUN=1", name, "/app/literouter", "-e", HEALTH_JS], { allowFail: true });
    if (probe.code === 0) return;
    await Bun.sleep(1000);
  }
  throw new Error(`container did not become healthy within ${timeoutMs / 1000}s:\n${docker(["logs", name], { allowFail: true }).out}`);
}

export async function smokeImage({ image, platform, timeoutS = DEFAULT_TIMEOUT_S }) {
  const name = containerName();
  const timeoutMs = timeoutS * 1000;
  try {
    docker([
      "run", "-d", "--name", name,
      ...(platform ? ["--platform", platform] : []),
      "-e", "DATA_DIR=/app/data",
      "-e", "INITIAL_PASSWORD=smoke-pass",
      "-e", `JWT_SECRET=${randomBytes(24).toString("hex")}`,
      "-e", `API_KEY_SECRET=${randomBytes(16).toString("hex")}`,
      "-e", `MACHINE_ID_SALT=${randomBytes(8).toString("hex")}`,
      "-e", "AUTH_COOKIE_SECURE=false",
      image,
    ]);
    await waitForHealth(name, timeoutMs);
    const pid = serverPid(docker(["exec", name, "ps", "-o", "pid=,args="]).out);
    const status = docker(["exec", name, "cat", `/proc/${pid}/status`]).out;
    assertLiterouterUid(status.match(/^Uid:\s+(\d+)/m)?.[1]);
    docker(["cp", SMOKE_SCRIPT, `${name}:/tmp/smoke-server.mjs`]);
    const smoke = docker(
      ["exec", "-e", "BUN_BE_BUN=1", name, "/app/literouter", "/tmp/smoke-server.mjs", "--base", BASE],
      { allowFail: true },
    );
    if (smoke.code !== 0) throw new Error(`smoke failed in container:\n${smoke.out}${smoke.err}`);
    return smoke.out.trim();
  } finally {
    docker(["rm", "-f", name], { allowFail: true });
  }
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const value = (flag) => {
      const index = argv.indexOf(flag);
      if (index === -1) return undefined;
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`);
      return next;
    };
    const platform = value("--platform");
    const timeout = value("--timeout");
    const image = argv.find((arg, index) => !arg.startsWith("--") && !["--platform", "--timeout"].includes(argv[index - 1]));
    if (!image) throw new Error("usage: smoke-image.mjs <image> [--platform linux/arm64] [--timeout <seconds>]");
    const timeoutS = timeout === undefined ? DEFAULT_TIMEOUT_S : Number(timeout);
    if (!Number.isFinite(timeoutS) || timeoutS <= 0) throw new Error("--timeout needs a positive number of seconds");
    console.log(await smokeImage({ image, platform, timeoutS }));
  } catch (error) {
    console.error(`image smoke failed: ${error.message}`);
    process.exit(1);
  }
}
