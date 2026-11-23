import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const WAIT_DEADLINE_MS = 30_000;
const HEALTH_POLL_MS = 250;
const JSON_HEADERS = { "content-type": "application/json" };

function startMockUpstream() {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.endsWith("/chat/completions")) {
        return Response.json({
          id: "chatcmpl-smoke",
          object: "chat.completion",
          created: 1,
          model: "smoke",
          choices: [{ index: 0, message: { role: "assistant", content: "smoke-ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

async function expectOk(res, label) {
  if (res.status >= 200 && res.status < 300) return res;
  throw new Error(`${label} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export async function runSmoke({ base, password = "smoke-pass" }) {
  const upstream = startMockUpstream();
  try {
    const login = await expectOk(
      await fetch(`${base}/api/auth/login`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password }) }),
      "POST /api/auth/login",
    );
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const post = async (path, body) => {
      const res = await expectOk(
        await fetch(`${base}${path}`, { method: "POST", headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify(body) }),
        `POST ${path}`,
      );
      return res.json();
    };
    const { node } = await post("/api/provider-nodes", {
      name: "smoke",
      prefix: "smoke",
      apiType: "chat",
      baseUrl: `${upstream.url}/v1`,
      type: "openai-compatible",
    });
    await post("/api/providers", { provider: node.id, name: "smoke-conn", apiKey: "smoke-upstream-key" });
    const { key } = await post("/api/keys", { name: "smoke" });

    const health = await expectOk(await fetch(`${base}/api/health`), "GET /api/health");
    const dashboard = await expectOk(await fetch(`${base}/dashboard`, { headers: { cookie } }), "GET /dashboard");
    const dashboardHtml = await dashboard.text();
    if (!dashboardHtml.includes("__LR_BOOT__")) throw new Error("GET /dashboard -> 200 without __LR_BOOT__");
    const chat = await expectOk(
      await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { ...JSON_HEADERS, authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "smoke/smoke", messages: [{ role: "user", content: "ping" }], stream: false }),
      }),
      "POST /v1/chat/completions",
    );
    const chatJson = await chat.json();
    const chatText = chatJson?.choices?.[0]?.message?.content ?? "";
    if (chatText !== "smoke-ok") throw new Error(`POST /v1/chat/completions -> unexpected body ${JSON.stringify(chatJson).slice(0, 300)}`);
    return { health: health.status, dashboard: dashboard.status, chat: chat.status, chatText };
  } finally {
    upstream.stop();
  }
}

function freePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = probe;
  probe.stop(true);
  return port;
}

export async function waitForHealth(base, child) {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    const healthy = await fetch(`${base}/api/health`).then((res) => res.status === 200, () => false);
    if (healthy) return;
    await Bun.sleep(HEALTH_POLL_MS);
  }
  throw new Error(`server did not answer /api/health within ${WAIT_DEADLINE_MS / 1000}s`);
}

export function killOnSignal(child, exit = process.exit) {
  const handler = (signal) => {
    child.kill();
    exit(signal === "SIGINT" ? 130 : 143);
  };
  const onInt = () => handler("SIGINT");
  const onTerm = () => handler("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  return () => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  };
}

export function spawnCommandFor(target) {
  const resolved = resolve(target);
  if (statSync(resolved).isDirectory()) return { cmd: ["bun", "index.js"], cwd: resolved };
  return { cmd: [resolved], cwd: dirname(resolved) };
}

export async function spawnSmoke(target, password = "smoke-pass") {
  let dataDir;
  let child;
  let disposeSignals = () => {};
  try {
    dataDir = mkdtempSync(join(tmpdir(), "lr-smoke-"));
    const port = freePort();
    const { cmd, cwd } = spawnCommandFor(target);
    const env = {
      ...process.env,
      DATA_DIR: dataDir,
      INITIAL_PASSWORD: password,
      JWT_SECRET: "smoke-jwt-secret-smoke-jwt-secret",
      API_KEY_SECRET: "smoke-api-secret",
      MACHINE_ID_SALT: "smoke-salt",
      AUTH_COOKIE_SECURE: "false",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    };
    for (const key of ["NODE_ENV", "LITEROUTER_SPA_DIR", "LITEROUTER_PUBLIC_DIR", "LITEROUTER_BUNDLED", "BUN_BE_BUN"]) delete env[key];
    child = Bun.spawn(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
    disposeSignals = killOnSignal(child);
    const base = `http://127.0.0.1:${port}`;
    await waitForHealth(base, child);
    return await runSmoke({ base, password });
  } finally {
    disposeSignals();
    if (child) {
      child.kill();
      await child.exited;
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const base = argValue(argv, "--base");
    const spawnTarget = argValue(argv, "--spawn");
    if (!base && !spawnTarget) throw new Error("usage: smoke-server.mjs --base <url> | --spawn <dir-with-index.js | executable>");
    const result = base ? await runSmoke({ base }) : await spawnSmoke(spawnTarget);
    console.log(`smoke ok: health=${result.health} dashboard=${result.dashboard} chat=${result.chat}`);
  } catch (error) {
    console.error(`smoke failed: ${error.message}`);
    process.exit(1);
  }
}
