import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_ENV, cliToken } from "./server-config.js";
import { startMockUpstream } from "./mock-upstream.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const strippedEnv = ["TRUST_LOOPBACK_AS_LOCAL", "TRUST_PROXY", "REQUIRE_API_KEY", "MINIMAL_PROFILE", "AUTH_COOKIE_SECURE", "API_KEY_FAIL_LIMIT"];

function freePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = probe;
  probe.stop(true);
  return port;
}

export async function startRealServer({ env = {} } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lr-real-"));
  const dataDir = path.join(work, "data");
  const home = path.join(work, "home");
  fs.mkdirSync(path.join(dataDir, "auth"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "machine-id"), SERVER_ENV.machineId);
  fs.writeFileSync(path.join(dataDir, "auth", "cli-secret"), SERVER_ENV.cliSecret);

  const mock = await startMockUpstream({ port: 0 });
  const baseEnv = { ...process.env, HOME: home, USERPROFILE: home };
  const seed = Bun.spawnSync(["bun", fileURLToPath(new URL("./seed.mjs", import.meta.url)), dataDir, "--upstream", mock.url, "--print-key"], { cwd: repoRoot, env: baseEnv });
  if (seed.exitCode !== 0) throw new Error(`seed failed: ${seed.stderr.toString()}${seed.stdout.toString()}`);

  const port = freePort();
  const childEnv = {
    ...baseEnv,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    JWT_SECRET: SERVER_ENV.jwtSecret,
    API_KEY_SECRET: SERVER_ENV.apiKeySecret,
    MACHINE_ID_SALT: SERVER_ENV.machineIdSalt,
    INITIAL_PASSWORD: SERVER_ENV.initialPassword,
    TZ: SERVER_ENV.tz,
    ...env,
  };
  for (const key of strippedEnv) delete childEnv[key];

  const child = Bun.spawn(["bun", path.join(repoRoot, "src/server/index.js")], { cwd: repoRoot, env: childEnv, stdout: "pipe", stderr: "pipe" });
  const log = [];
  for (const stream of [child.stdout, child.stderr]) {
    (async () => {
      for await (const chunk of stream) log.push(Buffer.from(chunk).toString());
    })();
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log.join("")}`);
    try {
      ready = (await fetch(`${baseUrl}/api/health`)).ok;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!ready) {
    child.kill();
    throw new Error(`server did not become healthy:\n${log.join("")}`);
  }

  return {
    baseUrl,
    port,
    child,
    mock,
    dataDir,
    log: () => log.join(""),
    apiKey: SERVER_ENV.apiKey,
    cliHeaders: { "x-9r-cli-token": cliToken() },
    chat(model, init = {}) {
      return fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${SERVER_ENV.apiKey}`, ...init.headers },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], stream: init.stream ?? false }),
      });
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([child.exited, Bun.sleep(5000)]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      await mock.stop();
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
