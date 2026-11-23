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
const PUB_MOCK = "http://11.0.0.10:9000";
const PRIV_MOCK = "http://mock:9000";
const LOOP_MOCK = "http://127.0.0.1:9001";

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
const ALL_REMOTE = [...LOCAL_ONLY, ...LOCAL_ONLY_POST];
const MINIMAL_HIDDEN_PREFIXES = ["/api/headroom"];

let envOverrides = { GATE_IMAGE: image, TRUST_LOOPBACK_AS_LOCAL: "true", MINIMAL_PROFILE: "true" };

const isHidden = (path) => envOverrides.MINIMAL_PROFILE === "true" && MINIMAL_HIDDEN_PREFIXES.some((p) => path.startsWith(p));
const expectedRemote = (path) => (isHidden(path) ? 404 : 403);
const methodFor = (path) => (LOCAL_ONLY_POST.includes(path) ? "POST" : "GET");

async function run(cmd) {
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
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

async function waitFor(label, probe) {
  for (let i = 0; i < 60; i++) {
    if (await probe()) return;
    await Bun.sleep(1000);
  }
  throw new Error(`${label} did not become ready within 60s`);
}

const waitHealthy = () =>
  waitFor("app", async () => {
    const r = await curl("client-remote", { url: `${APP}/api/auth/status` });
    return r.status > 0 && r.status < 500;
  });

const waitMock = (client, url) =>
  waitFor(`mock ${url}`, async () => (await curl(client, { url: `${url}/__hits` })).status === 200);

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

async function probeAll(client, base, paths, headers, cookie) {
  const out = [];
  for (const p of paths) {
    const method = methodFor(p);
    const r = await curl(client, { method, url: `${base}${p}`, headers: { cookie, ...headers }, body: method === "POST" ? "{}" : undefined });
    out.push({ p, method, status: r.status });
  }
  return out;
}

function verdict(id, label, rows, check, expectLabel) {
  const bad = rows.filter((r) => !check(r)).map((r) => `${r.method} ${r.p}=${r.status}`);
  record(id, bad.length === 0, bad.length === 0 ? `${label}: ${rows.length}/${rows.length} ${expectLabel}` : `${label}: unexpected ${bad.join(", ")}`);
}

const okLocal = (r) => r.status > 0 && r.status < 500 && r.status !== 403;
const is403 = (r) => r.status === 403;
const isExpectedRemote = (r) => r.status === expectedRemote(r.p);
const remoteLabel = () => (envOverrides.MINIMAL_PROFILE === "true" ? "403 (404 under MINIMAL_HIDDEN_PREFIXES)" : "403");

async function remoteSweep(id, label, base, headers, cookie) {
  const rows = await probeAll("client-remote", base, ALL_REMOTE, headers, cookie);
  verdict(id, label, rows, isExpectedRemote, remoteLabel());
}

async function legacyHeaderSweep(id, cookie) {
  const legacy = { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "x" };
  const rows = [
    ...(await probeAll("client-remote", APP, ALL_REMOTE, legacy, cookie)).map((r) => ({ ...r, p: r.p, method: `direct ${r.method}` })),
    ...(await probeAll("client-remote", CADDY_A, ALL_REMOTE, legacy, cookie)).map((r) => ({ ...r, method: `caddy ${r.method}` })),
  ];
  verdict(id, "remote with x-9r-* headers, direct+caddy", rows, isExpectedRemote, remoteLabel());
}

async function t11(cookie) {
  const hits = async (client, base) => Number((await curl(client, { url: `${base}/__hits` })).body);
  const reset = async () => {
    await curl("client-remote", { url: `${PRIV_MOCK}/__reset` });
    await curl("client-remote", { url: `${PUB_MOCK}/__reset` });
    await curl("client-loopback", { url: `${LOOP_MOCK}/__reset` });
  };

  const create = await curl("client-loopback", {
    method: "POST",
    url: `${LOCAL}/api/providers`,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ provider: "ollama-local", name: "gate-mock", providerSpecificData: { baseUrl: PRIV_MOCK } }),
  });
  const keyRes = await curl("client-loopback", {
    method: "POST",
    url: `${LOCAL}/api/keys`,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "gate" }),
  });
  const apiKey = (() => { try { return JSON.parse(keyRes.body).key; } catch { return null; } })();
  if (create.status >= 300 || !apiKey) {
    record("T11", false, `seed failed: provider ${create.status}, key ${keyRes.status}`);
    return;
  }

  const chat = async (imageUrl) => {
    await reset();
    const r = await curl("client-remote", {
      method: "POST",
      url: `${CADDY_A}/v1/chat/completions`,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "ollama-local/claude-sonnet-5-5",
        stream: false,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: imageUrl } }] }],
      }),
    });
    const upstream = (await curl("client-remote", { url: `${PRIV_MOCK}/__last` })).body;
    return { status: r.status, upstream, inlined: upstream.includes("iVBORw0KGgo") };
  };

  const problems = [];
  const control = await chat(`${PUB_MOCK}/x.png`);
  const controlHits = await hits("client-remote", PUB_MOCK);
  if (control.status !== 200 || controlHits !== 1 || !control.inlined) {
    problems.push(`positive control failed: status ${control.status}, public mock hits ${controlHits}, inlined=${control.inlined}, upstream=${control.upstream.slice(0, 120)}`);
  }

  const cases = [
    { name: "link-local 169.254.169.254", url: "http://169.254.169.254/x.png", counted: async () => 0 },
    { name: "loopback 127.0.0.1:9001", url: `${LOOP_MOCK}/x.png`, counted: () => hits("client-loopback", LOOP_MOCK) },
    { name: "private bridge host", url: `${PRIV_MOCK}/x.png`, counted: () => hits("client-remote", PRIV_MOCK) },
    {
      name: "public 302 to private host",
      url: `${PUB_MOCK}/redir`,
      counted: () => hits("client-remote", PRIV_MOCK),
      expectPublicHits: 1,
    },
  ];
  const summary = [];
  for (const c of cases) {
    const r = await chat(c.url);
    const n = await c.counted();
    const pub = await hits("client-remote", PUB_MOCK);
    summary.push(`${c.name}:${n}`);
    if (n !== 0) problems.push(`${c.name}: private mock recorded ${n} hits`);
    if (c.expectPublicHits !== undefined && pub !== c.expectPublicHits) problems.push(`${c.name}: public redirector hits ${pub}, expected ${c.expectPublicHits}`);
    if (r.inlined) problems.push(`${c.name}: upstream received inlined image bytes`);
    if (!r.upstream) problems.push(`${c.name}: request never reached the mock upstream (status ${r.status})`);
  }
  record("T11", problems.length === 0, problems.length === 0
    ? `control fetched public mock (hits 1, image inlined upstream); private/loopback/redirect hits [${summary.join(", ")}], no inlined bytes`
    : problems.join("; "));
}

async function leaked() {
  const filters = ["--filter", `label=com.docker.compose.project=${project}`];
  const found = [];
  const ps = await run(["docker", "ps", "-a", ...filters, "--format", "{{.Names}}"]);
  const nets = await run(["docker", "network", "ls", ...filters, "--format", "{{.Name}}"]);
  const vols = await run(["docker", "volume", "ls", ...filters, "--format", "{{.Name}}"]);
  for (const out of [ps, nets, vols]) found.push(...out.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
  const byName = await run(["docker", "ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}"]);
  found.push(...byName.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
  return [...new Set(found)];
}

let tornDown = false;
let teardownLeak = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  const down = await compose("down", "-v", "--remove-orphans", "-t", "1");
  if (down.code !== 0) {
    teardownLeak = true;
    console.log(`FAIL teardown compose down exited ${down.code}: ${down.stderr.trim()}`);
  }
  const left = await leaked();
  if (left.length > 0) {
    teardownLeak = true;
    console.log(`FAIL teardown leftover p5t4 objects: ${left.join(", ")}`);
  } else if (down.code === 0) {
    console.log(`PASS teardown no leftover ${project} containers, networks or volumes`);
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await teardown();
    process.exit(130);
  });
}

async function recreate(services) {
  const re = await compose("up", "-d", "--force-recreate", ...services);
  if (re.code !== 0) throw new Error(`recreate failed: ${re.stderr.trim()}`);
  await waitHealthy();
}

let crashed = false;
try {
  const up = await compose("up", "-d");
  if (up.code !== 0) throw new Error(`compose up failed: ${up.stderr.trim()}`);
  await waitHealthy();
  await waitMock("client-remote", PRIV_MOCK);
  await waitMock("client-remote", PUB_MOCK);
  await waitMock("client-loopback", LOOP_MOCK);
  const cookie = await login();

  verdict("T1", "loopback direct", await probeAll("client-loopback", LOCAL, LOCAL_ALLOWED, { }, cookie), okLocal, "not 403 and not 5xx");
  verdict("T2", "loopback via caddy (B)", await probeAll("client-loopback", CADDY_B, LOCAL_ALLOWED, {}, cookie), is403, "403");
  await remoteSweep("T3", "remote direct", APP, {}, cookie);
  await remoteSweep("T4", "remote direct, spoofed XFF 127.0.0.1", APP, { "X-Forwarded-For": "127.0.0.1" }, cookie);
  await remoteSweep("T5", "remote via caddy (A), spoofed XFF 127.0.0.1", CADDY_A, { "X-Forwarded-For": "127.0.0.1" }, cookie);
  verdict("T6", "loopback direct, XFF 203.0.113.9", await probeAll("client-loopback", LOCAL, LOCAL_ALLOWED, { "X-Forwarded-For": "203.0.113.9" }, cookie), is403, "403");
  await legacyHeaderSweep("T8", cookie);
  verdict("T9", "loopback direct, x-9r-real-ip 8.8.8.8", await probeAll("client-loopback", LOCAL, LOCAL_ALLOWED, { "x-9r-real-ip": "8.8.8.8" }, cookie), okLocal, "not 403 and not 5xx");

  const t10 = await curl("client-remote", { url: `${CADDY_A}/v1/models` });
  record("T10", t10.status === 401, `remote via caddy, keyless GET /v1/models: ${t10.status}`);

  await t11(cookie);

  envOverrides = { ...envOverrides, TRUST_LOOPBACK_AS_LOCAL: "false" };
  await recreate(["app", "client-loopback"]);
  verdict("T7", "TRUST_LOOPBACK_AS_LOCAL=false, loopback direct", await probeAll("client-loopback", LOCAL, LOCAL_ALLOWED, {}, cookie), is403, "403");

  envOverrides = { ...envOverrides, TRUST_LOOPBACK_AS_LOCAL: "true", MINIMAL_PROFILE: "false" };
  await recreate(["app", "client-loopback", "caddy-a"]);
  await remoteSweep("T3-nominimal", "remote direct, MINIMAL_PROFILE=false", APP, {}, cookie);
  await legacyHeaderSweep("T8-nominimal", cookie);
} catch (err) {
  crashed = true;
  console.log(`FAIL harness ${err.message}`);
} finally {
  await teardown();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} cases passed${crashed ? " (harness error)" : ""}${teardownLeak ? " (teardown leaked)" : ""}`);
process.exit(failed > 0 || crashed || teardownLeak ? 1 : 0);
