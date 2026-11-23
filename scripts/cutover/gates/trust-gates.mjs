#!/usr/bin/env bun
import { join } from "node:path";

const image = process.argv[2];
if (!image) {
  console.error("usage: bun scripts/cutover/gates/trust-gates.mjs <image>");
  process.exit(2);
}

const dir = import.meta.dir;
const composeFile = join(dir, "compose.yml");
const project = `p5t4-${Math.random().toString(36).slice(2, 8)}`;
const PORT = 20128;
const CADDY_PORT = 8080;
const APP = `http://app:${PORT}`;
const LOCAL = `http://127.0.0.1:${PORT}`;
const CADDY_A = `http://caddy-a:${CADDY_PORT}`;
const CADDY_B = `http://127.0.0.1:${CADDY_PORT}`;

const LOCAL_ALLOWED = ["/api/oauth/cursor/auto-import", "/api/oauth/kiro/auto-import"];
const LOCAL_ONLY = [
  ...LOCAL_ALLOWED,
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
  "/api/headroom/restart",
  "/api/pxpipe/install",
  "/api/pxpipe/start",
];
const LOCAL_ONLY_POST = ["/api/headroom/extras"];

let envOverrides = { GATE_IMAGE: image, TRUST_LOOPBACK_AS_LOCAL: "true" };

async function run(cmd, { input } = {}) {
  const proc = Bun.spawn(cmd, {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...envOverrides, COMPOSE_PROJECT_NAME: project },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const compose = (...args) => run(["docker", "compose", "-p", project, "-f", composeFile, ...args]);

async function curl(client, { method = "GET", url, headers = {}, body, includeHeaders = false }) {
  const args = ["docker", "compose", "-p", project, "-f", composeFile, "exec", "-T", client, "curl", "-s", "-m", "20"];
  if (includeHeaders) args.push("-i");
  args.push("-o", "-", "-w", "\n__STATUS__%{http_code}", "-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body !== undefined) args.push("--data-binary", body);
  args.push(url);
  const { stdout } = await run(args);
  const i = stdout.lastIndexOf("\n__STATUS__");
  if (i === -1) return { status: 0, body: stdout };
  return { status: Number(stdout.slice(i + 11)), body: stdout.slice(0, i) };
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    const r = await curl("client-remote", { url: `${APP}/api/auth/status` });
    if (r.status > 0 && r.status < 500) return;
    await Bun.sleep(1000);
  }
  throw new Error("app did not become healthy within 60s");
}

async function login() {
  const r = await curl("client-loopback", {
    method: "POST",
    url: `${LOCAL}/api/auth/login`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "gate-password" }),
    includeHeaders: true,
  });
  const m = r.body.match(/auth_token=([^;\s]+)/i);
  if (!m) throw new Error(`login failed: status ${r.status}`);
  return `auth_token=${m[1]}`;
}

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
}

async function sweep(id, label, client, base, paths, extraHeaders, cookie, predicate, expectLabel) {
  const bad = [];
  for (const p of paths) {
    const method = LOCAL_ONLY_POST.includes(p) ? "POST" : "GET";
    const r = await curl(client, {
      method,
      url: `${base}${p}`,
      headers: { cookie, ...extraHeaders },
      body: method === "POST" ? "{}" : undefined,
    });
    if (!predicate(r.status)) bad.push(`${method} ${p}=${r.status}`);
  }
  record(id, bad.length === 0, bad.length === 0 ? `${label}: ${paths.length}/${paths.length} ${expectLabel}` : `${label}: unexpected ${bad.join(", ")}`);
}

const is403 = (s) => s === 403;
const not403 = (s) => s !== 403 && s !== 0;
const ALL_REMOTE = [...LOCAL_ONLY, ...LOCAL_ONLY_POST];

async function t11(key) {
  const hits = async () => Number((await curl("client-remote", { url: "http://mock:9000/__hits" })).body);
  await curl("client-remote", { url: "http://mock:9000/x.png" });
  const control = await hits();
  await curl("client-remote", { url: "http://mock:9000/__reset" });
  if (control !== 1) {
    record("T11", false, `mock control hit count was ${control}, expected 1`);
    return;
  }
  const targets = [
    "http://169.254.169.254/x.png",
    "http://127.0.0.1:9000/x.png",
    "http://mock:9000/x.png",
    "http://mock:9000/redir",
  ];
  const problems = [];
  const statuses = [];
  for (const url of targets) {
    const r = await curl("client-remote", {
      method: "POST",
      url: `${CADDY_A}/v1/chat/completions`,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini/gemini-2.5-flash",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url } }] }],
      }),
    });
    statuses.push(r.status);
    if (r.status < 100 || r.status >= 600) problems.push(`${url} no clean response (status ${r.status})`);
  }
  const n = await hits();
  if (n !== 0) problems.push(`mock recorded ${n} hits`);
  record("T11", problems.length === 0, problems.length === 0 ? `mock hits=0, responses=${statuses.join("/")}` : problems.join("; "));
}

let tornDown = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  await compose("down", "-v", "--remove-orphans", "-t", "1");
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await teardown();
    process.exit(130);
  });
}

let crashed = false;
try {
  const up = await compose("up", "-d");
  if (up.code !== 0) throw new Error(`compose up failed: ${up.stderr.trim()}`);
  await waitHealthy();
  const cookie = await login();
  const create = await curl("client-loopback", {
    method: "POST",
    url: `${LOCAL}/api/providers`,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ provider: "gemini", apiKey: "gate-fake-key", name: "gate" }),
  });
  const keyRes = await curl("client-loopback", {
    method: "POST",
    url: `${LOCAL}/api/keys`,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "gate" }),
  });
  const apiKey = (() => { try { return JSON.parse(keyRes.body).key; } catch { return null; } })();
  if (create.status >= 300 || !apiKey) throw new Error(`seed failed: provider ${create.status}, key ${keyRes.status}`);

  await sweep("T1", "loopback direct", "client-loopback", LOCAL, LOCAL_ALLOWED, {}, cookie, not403, "not 403");
  await sweep("T2", "loopback via caddy (B)", "client-loopback", CADDY_B, LOCAL_ALLOWED, {}, cookie, is403, "403");
  await sweep("T3", "remote direct", "client-remote", APP, ALL_REMOTE, {}, cookie, is403, "403");
  await sweep("T4", "remote direct, spoofed XFF 127.0.0.1", "client-remote", APP, ALL_REMOTE, { "X-Forwarded-For": "127.0.0.1" }, cookie, is403, "403");
  await sweep("T5", "remote via caddy (A), spoofed XFF 127.0.0.1", "client-remote", CADDY_A, ALL_REMOTE, { "X-Forwarded-For": "127.0.0.1" }, cookie, is403, "403");
  await sweep("T6", "loopback direct, XFF 203.0.113.9", "client-loopback", LOCAL, LOCAL_ALLOWED, { "X-Forwarded-For": "203.0.113.9" }, cookie, is403, "403");

  const legacy = { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "x" };
  const t8 = [];
  for (const [label, base] of [["direct", APP], ["caddy", CADDY_A]]) {
    for (const p of ALL_REMOTE) {
      const method = LOCAL_ONLY_POST.includes(p) ? "POST" : "GET";
      const r = await curl("client-remote", { method, url: `${base}${p}`, headers: { cookie, ...legacy }, body: method === "POST" ? "{}" : undefined });
      if (r.status !== 403) t8.push(`${label} ${method} ${p}=${r.status}`);
    }
  }
  record("T8", t8.length === 0, t8.length === 0 ? `remote with x-9r-* headers, direct+caddy: ${ALL_REMOTE.length * 2}/${ALL_REMOTE.length * 2} 403` : `unexpected ${t8.join(", ")}`);

  await sweep("T9", "loopback direct, x-9r-real-ip 8.8.8.8", "client-loopback", LOCAL, LOCAL_ALLOWED, { "x-9r-real-ip": "8.8.8.8" }, cookie, not403, "not 403");

  const t10 = await curl("client-remote", { url: `${CADDY_A}/v1/models` });
  record("T10", t10.status === 401, `remote via caddy, keyless GET /v1/models: ${t10.status}`);

  await t11(apiKey);

  envOverrides = { ...envOverrides, TRUST_LOOPBACK_AS_LOCAL: "false" };
  const re = await compose("up", "-d", "--force-recreate", "app", "client-loopback");
  if (re.code !== 0) throw new Error(`recreate failed: ${re.stderr.trim()}`);
  await waitHealthy();
  await sweep("T7", "TRUST_LOOPBACK_AS_LOCAL=false, loopback direct", "client-loopback", LOCAL, LOCAL_ALLOWED, {}, cookie, is403, "403");
} catch (err) {
  crashed = true;
  console.log(`FAIL harness ${err.message}`);
} finally {
  await teardown();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} cases passed${crashed ? " (harness error)" : ""}`);
process.exit(failed > 0 || crashed ? 1 : 0);
