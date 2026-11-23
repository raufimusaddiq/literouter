import { describe, test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMockUpstream } from "./mock-upstream.js";
import { normalizeBody, normalizeHeaders, normalizeSse, maskRetryAfter } from "./normalize.js";
import { compareDirs, diffValues, loadKnownDiffs, validateKnownDiffs } from "./compare.mjs";
import { fixtureFileNames, loadFixtures, record } from "./record.mjs";
import { compareUpstream, compareUpstreamDirs, loadKnownUpstreamDiffs, requestsByFixture } from "./compare-upstream.mjs";

const repoRoot = path.resolve(import.meta.dir, "../..");
const fixtureDir = path.join(import.meta.dir, "fixtures");
const chat = (model, extra = {}) => JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], ...extra });
const post = (url, body, route = "/v1/chat/completions") => fetch(url + route, { method: "POST", headers: { "content-type": "application/json" }, body });

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
const tmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const mockUp = async (opts) => {
  const mock = await startMockUpstream(opts);
  cleanup.push(() => mock.stop());
  return mock;
};

describe("mock upstream", () => {
  test("mock upstream replays each scenario", async () => {
    const mock = await mockUp();

    const ok = await post(mock.url, chat("mock-ok"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).choices[0].message.content).toBe("parity ok");

    const stream = await post(mock.url, chat("mock-stream", { stream: true }));
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const frames = normalizeSse(await stream.text());
    expect(frames.at(-1)).toEqual({ data: "[DONE]" });
    expect(frames.length).toBe(4);

    const limited = await post(mock.url, chat("mock-429"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("7");

    const truncated = await (await post(mock.url, chat("mock-truncated-stream", { stream: true }))).text();
    expect(truncated).toContain("data: {");
    expect(truncated).not.toContain("[DONE]");

    expect((await post(mock.url, chat("mock-500"))).status).toBe(500);
    expect(await (await post(mock.url, chat("mock-bad-json"))).text()).toBe("{not json");

    expect(mock.requests.map((r) => r.method + " " + r.path)).toEqual(Array(6).fill("POST /v1/chat/completions"));
    expect(mock.requests[0].body).toBe(chat("mock-ok"));
    expect(mock.requests[0].headers["content-type"]).toBe("application/json");
  });

  test("mock upstream serves models and messages and resets", async () => {
    const mock = await mockUp();
    const models = await (await fetch(mock.url + "/v1/models")).json();
    expect(models.data.map((m) => m.id)).toContain("mock-ok");
    expect((await post(mock.url, chat("mock-ok"), "/v1/messages")).status).toBe(200);
    expect((await fetch(mock.url + "/nope")).status).toBe(404);
    expect(mock.requests.length).toBe(3);
    mock.reset();
    expect(mock.requests).toEqual([]);
  });

  test("mock upstream writes upstream-requests.jsonl with wire-order headers and raw body bytes", async () => {
    const outDir = tmp("parity-jsonl-");
    const mock = await mockUp({ outDir });
    const body = chat("mock-ok");
    await post(mock.url, body);
    await fetch(mock.url + "/v1/models");

    const lines = fs.readFileSync(path.join(outDir, "upstream-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.seq)).toEqual([0, 1]);
    expect(lines[0].method).toBe("POST");
    expect(Array.isArray(lines[0].headers[0])).toBe(true);
    expect(lines[0].headers.map(([k]) => k)).toContain("content-type");
    expect(Buffer.from(lines[0].bodyBase64, "base64").toString()).toBe(body);
    expect(lines[1].bodyBase64).toBe("");
  });
});

describe("normalize", () => {
  test("normalize masks volatile values and keeps structure", () => {
    const input = {
      zeta: "2026-11-22T10:20:30.123Z",
      alpha: 1763800000000,
      id: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d",
      token: "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig-_x",
      completion: "chatcmpl-abc123",
      message: "msg_01AbC",
      nested: [{ keep: "plain", n: 5, note: "at 2026-11-22T10:20:30Z and 1763800000000" }],
      latencyMs: 42,
    };
    const out = normalizeBody(input);
    expect(Object.keys(out)).toEqual(Object.keys(input));
    expect(out).toEqual({
      zeta: "<ISO>",
      alpha: "<EPOCH_MS>",
      id: "<UUID>",
      token: "<JWT>",
      completion: "chatcmpl-<ID>",
      message: "msg_<ID>",
      nested: [{ keep: "plain", n: 5, note: "at <ISO> and <EPOCH_MS>" }],
      latencyMs: "<MS>",
    });
  });

  test("normalize masks cooldown countdowns", () => {
    expect(normalizeBody({ error: "[x] [429]: slow (reset after 2s)" })).toEqual({ error: "[x] [429]: slow (reset after <N>s)" });
  });

  test("normalize keeps small numbers, booleans and null", () => {
    expect(normalizeBody({ a: 1763800000, b: true, c: null, d: [] })).toEqual({ a: 1763800000, b: true, c: null, d: [] });
  });

  test("normalizeHeaders keeps the allowlist and masks set-cookie values", () => {
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-powered-by": "Next.js",
      date: "now",
      "retry-after": "7",
    });
    headers.append("set-cookie", "auth_token=eyJabc.def.ghi; Path=/; Expires=Mon, 23 Nov 2026 10:00:00 GMT; Max-Age=86400; HttpOnly; SameSite=lax");
    expect(normalizeHeaders(headers, Date.parse("2026-11-22T10:00:00Z"))).toEqual({
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-type": "application/json",
      "retry-after": "7",
      "set-cookie": ["auth_token=<MASKED>; Path=/; Expires=<DATE-FUTURE>; Max-Age=86400; HttpOnly; SameSite=lax"],
    });
  });

  test("set-cookie Expires keeps whether the cookie is expired, so a logout that stops expiring is a diff", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    const cookie = (expires) => normalizeHeaders(new Headers([["set-cookie", `auth_token=; Path=/; Expires=${expires}`]]), now)["set-cookie"][0];
    expect(cookie("Thu, 01 Jan 1970 00:00:00 GMT")).toBe("auth_token=<MASKED>; Path=/; Expires=<DATE-PAST>");
    expect(cookie("Tue, 24 Nov 2026 10:00:00 GMT")).toBe("auth_token=<MASKED>; Path=/; Expires=<DATE-FUTURE>");
    expect(cookie("Sun, 22 Nov 2026 10:00:00 GMT")).toBe("auth_token=<MASKED>; Path=/; Expires=<DATE-PAST>");
    expect(cookie("garbage")).toBe("auth_token=<MASKED>; Path=/; Expires=<DATE-INVALID>");
    expect(cookie("Thu, 01 Jan 1970 00:00:00 GMT")).not.toBe(cookie("Tue, 24 Nov 2026 10:00:00 GMT"));
  });

  test("set-cookie keeps Max-Age, attribute names and flags", () => {
    const headers = new Headers([["set-cookie", "auth_token=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict"]]);
    expect(normalizeHeaders(headers)["set-cookie"]).toEqual(["auth_token=<MASKED>; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict"]);
  });

  test("maskRetryAfter hides countdown values", () => {
    expect(maskRetryAfter({ error: "Too many failed attempts. Try again in 29s. Reset", retryAfter: 29 })).toEqual({
      error: "Too many failed attempts. Try again in <N>s. Reset",
      retryAfter: "<N>",
    });
  });

  test("normalizeSse splits frames and keeps comment lines", () => {
    expect(normalizeSse(': keepalive\n\ndata: {"a":1}\n\n')).toEqual([{ comment: "keepalive", data: "" }, { data: '{"a":1}' }]);
    expect(normalizeSse("event: ping\ndata: x\n\ndata: [DONE]\n\n")).toEqual([{ event: "ping", data: "x" }, { data: "[DONE]" }]);
    expect(normalizeSse("data: chatcmpl-zzz\r\n\r\n")).toEqual([{ data: "chatcmpl-<ID>" }]);
  });
});

describe("compare", () => {
  const write = (dir, name, value) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));

  test("compare reports path, expected and actual", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { status: 200, body: { items: [1, 2], keep: "x" } });
    write(actual, "a", { status: 200, body: { items: [1, 3], keep: "x" } });
    write(expected, "only-expected", { status: 200 });
    const { unlisted, stale } = compareDirs(expected, actual, []);
    expect(unlisted).toEqual([
      { file: "a", path: "body.items[1]", expected: 2, actual: 3 },
      { file: "only-expected", path: "", expected: { status: 200 }, actual: undefined },
    ]);
    expect(stale).toEqual([]);
  });

  test("compare accepts a listed known-diff", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { status: 200 });
    write(actual, "a", { status: 201 });
    const { unlisted, stale } = compareDirs(expected, actual, [{ file: "a", path: "status", reason: "intentional" }]);
    expect(unlisted).toEqual([]);
    expect(stale).toEqual([]);
  });

  test("a known-diff that pins the actual value stops matching when the value changes", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { status: 200 });
    write(actual, "a", { status: 500 });
    const pinned = (value) => [{ file: "a", path: "status", actual: value, reason: "pinned to one value" }];
    expect(compareDirs(expected, actual, pinned(500))).toMatchObject({ unlisted: [], stale: [] });
    const worse = compareDirs(expected, actual, pinned(201));
    expect(worse.unlisted.map((d) => d.path)).toEqual(["status"]);
    expect(worse.stale.length).toBe(1);
  });

  test("a known-diff marked absent matches only a value that is missing from the actual output", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { headers: { "content-encoding": "gzip" } });
    write(actual, "a", { headers: {} });
    const absent = [{ file: "a", path: "headers.content-encoding", absent: true, reason: "the header is no longer sent" }];
    expect(compareDirs(expected, actual, absent)).toMatchObject({ unlisted: [], stale: [] });
    const present = tmp("parity-act-");
    write(present, "a", { headers: { "content-encoding": "br" } });
    const changed = compareDirs(expected, present, absent);
    expect(changed.unlisted.map((d) => d.path)).toEqual(["headers.content-encoding"]);
    expect(changed.stale.length).toBe(1);
  });

  test("a known-diff marked any matches whatever value is present and goes stale when the value is missing", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { body: { sha256: "one" } });
    write(actual, "a", { body: { sha256: "two" } });
    const any = [{ file: "a", path: "body.sha256", any: true, reason: "the value follows the catalog" }];
    expect(compareDirs(expected, actual, any)).toMatchObject({ unlisted: [], stale: [] });
    const other = tmp("parity-act-");
    write(other, "a", { body: { sha256: "three" } });
    expect(compareDirs(expected, other, any)).toMatchObject({ unlisted: [], stale: [] });
    const missing = tmp("parity-act-");
    write(missing, "a", { body: {} });
    const gone = compareDirs(expected, missing, any);
    expect(gone.unlisted.map((d) => d.path)).toEqual(["body.sha256"]);
    expect(gone.stale.length).toBe(1);
    expect(validateKnownDiffs([{ ...any[0], actual: "x" }])).toEqual(["known-diffs[0]: any cannot be combined with actual or absent"]);
  });

  test("every committed known-diff pins its actual value, marks it absent, or is marked any", () => {
    const unpinned = loadKnownDiffs().filter((k) => !("actual" in k) && k.absent !== true && k.any !== true);
    expect(unpinned).toEqual([]);
  });

  test("only the catalog-coupled known-diffs are marked any", () => {
    const anyPaths = loadKnownDiffs().filter((k) => k.any === true).map((k) => `${k.file}:${k.path}`).sort();
    expect(anyPaths).toEqual([
      "api-v1-models-noauth:body.data",
      "api-v1-noauth:body.data",
      "api-v1beta-models-noauth:body.bytes",
      "api-v1beta-models-noauth:body.sha256",
      "api-v1beta-models-noauth:body.shape",
    ]);
  });

  test("known-diffs entries need a file, a path and a reason", () => {
    expect(validateKnownDiffs([{ file: "a", path: "status", reason: "documented difference" }])).toEqual([]);
    expect(validateKnownDiffs([{ file: "a", path: "status" }])).toEqual(["known-diffs[0]: reason of at least 10 characters is required"]);
    expect(validateKnownDiffs([{ path: "x", reason: "documented difference" }])).toEqual(["known-diffs[0]: file and path must be strings"]);
  });

  test("the committed known-diffs cover only the local-trust fixtures and the login without a password", () => {
    const known = loadKnownDiffs();
    expect(known.length).toBeGreaterThan(0);
    const files = [...new Set(known.map((k) => k.file))].sort();
    expect(files).toEqual([
      "api-auth-login-noauth",
      "api-v1-api-chat-noauth",
      "api-v1-chat-completions-noauth",
      "api-v1-messages-count-tokens-noauth",
      "api-v1-messages-noauth",
      "api-v1-models-info-noauth",
      "api-v1-models-kind-noauth",
      "api-v1-models-model-noauth",
      "api-v1-models-noauth",
      "api-v1-noauth",
      "api-v1-responses-compact-noauth",
      "api-v1-responses-noauth",
      "api-v1-systemone-noauth",
      "api-v1beta-models-noauth",
      "api-v1beta-models-path-noauth",
      "trust-headroom-start-loopback-session",
      "trust-kiro-auto-import-loopback-session",
      "trust-reset-password-loopback-session",
      "v1-auth-loopback-nokey",
      "v1-auth-loopback-wrongkey",
    ]);
    for (const file of files) expect(fs.existsSync(path.join(import.meta.dir, "expected", `${file}.json`))).toBe(true);
  });

  test("compare fails on a stale known-diff", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    write(expected, "a", { status: 200 });
    write(actual, "a", { status: 200 });
    const known = [{ file: "a", path: "status", reason: "was intentional" }];
    const { unlisted, stale } = compareDirs(expected, actual, known);
    expect(unlisted).toEqual([]);
    expect(stale).toEqual(known);
  });

  test("compare cli exits 1 on an unlisted diff and 0 on equal dirs", () => {
    const expected = tmp("parity-exp-");
    const actual = tmp("parity-act-");
    const same = tmp("parity-same-");
    write(expected, "a", { status: 200 });
    write(actual, "a", { status: 500 });
    write(same, "a", { status: 200 });
    const script = path.join(import.meta.dir, "compare.mjs");
    const none = path.join(tmp("parity-known-"), "none.json");
    fs.writeFileSync(none, "[]");
    const bad = Bun.spawnSync([process.execPath, script, expected, actual, "--known", none]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("DIFF a status");
    expect(Bun.spawnSync([process.execPath, script, expected, same, "--known", none]).exitCode).toBe(0);
  });

  test("diffValues treats equal values as no diff", () => {
    expect(diffValues({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });
});

describe("compare-upstream", () => {
  const req = (headers, body = "x") => ({ seq: 0, method: "POST", path: "/v1/chat/completions", headers, bodyBase64: Buffer.from(body).toString("base64") });

  test("headers compare as a sorted map and bodies byte for byte", () => {
    const a = req([["b", "2"], ["a", "1"]]);
    const b = req([["a", "1"], ["b", "2"]]);
    expect(compareUpstream([a], [b])).toEqual([]);
    expect(compareUpstream([a], [req([["a", "1"], ["b", "3"]])])).toEqual(['#0 header b: expected "2", actual "3"']);
    expect(compareUpstream([a], [req([["a", "1"], ["b", "2"]], "y")])[0]).toContain("body differs");
    expect(compareUpstream([a], [])[0]).toContain("request count");
  });

  test("allowlisted headers are ignored", () => {
    const a = req([["user-agent", "A"], ["x", "1"]]);
    const b = req([["user-agent", "B"], ["x", "1"]]);
    expect(compareUpstream([a], [b], [{ header: "User-Agent", reason: "test" }])).toEqual([]);
    expect(compareUpstream([a], [b]).length).toBe(1);
  });

  test("the committed allowlist gives every entry a reason", () => {
    const list = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "runtime-header-allowlist.json"), "utf8"));
    for (const entry of list) {
      expect(typeof entry.header).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("seed", () => {
  test("seed loads the payload through importDb and prints the key", () => {
    const dir = tmp("parity-seed-");
    const run = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "seed.mjs"), dir, "--upstream", "http://127.0.0.1:1234", "--print-key"], { cwd: repoRoot });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim().split("\n").pop()).toBe("sk-parity-valid");
    const db = new Database(path.join(dir, "db", "data.sqlite"), { readonly: true });
    expect(db.query("SELECT key FROM apiKeys").all()).toEqual([{ key: "sk-parity-valid" }]);
    expect(db.query("SELECT name FROM combos").all()).toEqual([{ name: "parity-combo" }]);
    const nodes = db.query("SELECT data FROM providerNodes").all();
    expect(JSON.parse(nodes[0].data).baseUrl).toBe("http://127.0.0.1:1234/v1");
    const settings = JSON.parse(db.query("SELECT data FROM settings").get().data);
    expect(settings.requireLogin).toBe(true);
    expect(settings.password).toStartWith("$2b$");
    db.close();
  });

  test("the seeded password hash verifies parity-pass", async () => {
    const seed = JSON.parse(fs.readFileSync(path.join(fixtureDir, "seed.json"), "utf8"));
    expect(await Bun.password.verify("parity-pass", seed.settings.password)).toBe(true);
  });
});

const ROUTE_ROOT = path.join(repoRoot, "src/app/api");
const ALLOWED_SKIP = [/^oauth\//, /^headroom\//, /^pxpipe\//, /^proxy-pools\/netlify-deploy$/, /^providers\/validate$/];

function listRoutes() {
  const routes = [];
  for (const file of new Bun.Glob("**/route.js").scanSync({ cwd: ROUTE_ROOT })) {
    routes.push(path.dirname(file).split(path.sep).join("/").replace(/^\.$/, ""));
  }
  return routes.sort();
}

const segmentRank = (seg) => (seg.startsWith("[...") ? 0 : seg.startsWith("[") ? 1 : 2);

function routeMatches(route, segments) {
  const parts = route === "" ? [] : route.split("/");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("[...")) return i < segments.length;
    if (i >= segments.length) return false;
    if (!parts[i].startsWith("[") && parts[i] !== segments[i]) return false;
  }
  return parts.length === segments.length;
}

function apiSegments(rawPath) {
  let p = rawPath.split("?")[0].replace(/\/+$/, "");
  if (p.startsWith("/api/")) p = p.slice(5);
  else if (p === "/responses" || p.startsWith("/codex/")) p = "v1/responses";
  else if (p.startsWith("/v1/v1")) p = p.slice(4);
  else p = p.slice(1);
  return p.split("/").filter(Boolean);
}

function routeFor(rawPath, routes) {
  const segments = apiSegments(rawPath);
  const candidates = routes.filter((r) => routeMatches(r, segments));
  candidates.sort((a, b) => {
    const pa = a.split("/").map(segmentRank);
    const pb = b.split("/").map(segmentRank);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pb[i] ?? -1) !== (pa[i] ?? -1)) return (pb[i] ?? -1) - (pa[i] ?? -1);
    }
    return 0;
  });
  return candidates[0];
}


describe("fixtures", () => {
  test("fixture coverage", () => {
    const routes = listRoutes();
    expect(routes.length).toBeGreaterThan(90);
    const coverage = JSON.parse(fs.readFileSync(path.join(fixtureDir, "coverage.json"), "utf8"));
    const covered = new Set(loadFixtures().map((fx) => routeFor(fx.path, routes)).filter((r) => r !== undefined));

    for (const [route, entry] of Object.entries(coverage.skip)) {
      expect(routes).toContain(route);
      expect(typeof entry.reason === "string" && entry.reason.length > 10).toBe(true);
      expect(ALLOWED_SKIP.some((re) => re.test(route))).toBe(true);
    }
    expect(routes.filter((r) => !covered.has(r))).toEqual([]);
    expect(Object.keys(coverage.skip).filter((r) => !covered.has(r))).toEqual([]);
  });

  test("fixture ids are unique, match their file name and follow the schema", () => {
    const seen = new Set();
    for (const name of fixtureFileNames()) {
      const fx = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
      expect(`${fx.id}.json`).toBe(name);
      expect(seen.has(fx.id)).toBe(false);
      seen.add(fx.id);
      expect(["loopback", "proxied", "lan"]).toContain(fx.peer);
      expect(["none", "cli", "apikey", "session"]).toContain(fx.auth);
      expect(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]).toContain(fx.method);
      expect(fx.path.startsWith("/")).toBe(true);
      expect(fx.json !== undefined && fx.body !== undefined).toBe(false);
      expect(/^(v1|api|trust|edge|zz)-/.test(fx.id)).toBe(true);
      if (fx.sse) expect(fx.sse.maxMs).toBeGreaterThan(0);
    }
  });

  test("stateful throttle fixtures sort last", () => {
    const fixtures = loadFixtures();
    const ids = fixtures.map((fx) => fx.id).sort();
    const zz = ids.filter((id) => id.startsWith("zz-"));
    expect(zz.length).toBeGreaterThanOrEqual(2);
    expect(ids.slice(-zz.length)).toEqual(zz);
    expect(fixtures.find((fx) => fx.id === "zz-throttle-wrong-keys").repeat.until).toBe(429);
    expect(fixtures.find((fx) => fx.id === "zz-login-lockout").repeat.until).toBe(429);
  });

  test("every spec group is present", () => {
    const ids = loadFixtures().map((fx) => fx.id);
    for (const prefix of ["v1-", "api-", "trust-", "edge-", "zz-"]) expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
    for (const peer of ["loopback", "proxied", "lan"]) {
      for (const key of ["nokey", "wrongkey", "validkey", "cli"]) expect(ids).toContain(`v1-auth-${peer}-${key}`);
    }
  });

  test("the committed expected directory has one output per fixture", () => {
    const expectedDir = path.join(import.meta.dir, "expected");
    const ids = loadFixtures().map((fx) => fx.id).sort();
    const outputs = fs.readdirSync(expectedDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(outputs).toEqual(ids);
  });
});

describe("guard fixtures for skipped routes", () => {
  test("every allowed skip route keeps an unauthenticated guard fixture for loopback, proxied and lan", () => {
    const routes = listRoutes();
    const coverage = JSON.parse(fs.readFileSync(path.join(fixtureDir, "coverage.json"), "utf8"));
    const fixtures = loadFixtures();
    for (const route of Object.keys(coverage.skip)) {
      const peers = new Set(fixtures.filter((fx) => fx.auth === "none" && routeFor(fx.path, routes) === route).map((fx) => fx.peer));
      expect({ route, peers: [...peers].sort() }).toEqual({ route, peers: ["lan", "loopback", "proxied"] });
    }
  });

  test("the recorded guard for every remote peer on a skipped route is 401 or 403", () => {
    const routes = listRoutes();
    const coverage = JSON.parse(fs.readFileSync(path.join(fixtureDir, "coverage.json"), "utf8"));
    const guards = loadFixtures().filter((fx) => fx.auth === "none" && fx.peer !== "loopback" && coverage.skip[routeFor(fx.path, routes)]);
    expect(guards.length).toBeGreaterThanOrEqual(Object.keys(coverage.skip).length * 2);
    for (const fx of guards) {
      const out = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "expected", `${fx.id}.json`), "utf8"));
      expect({ id: fx.id, status: [401, 403].includes(out.status) ? "guarded" : out.status }).toEqual({ id: fx.id, status: "guarded" });
      expect(out.upstream).toEqual([]);
    }
  });

  test("only zz fixtures use the slow stream scenario, so no earlier fixture's output depends on it finishing", () => {
    const users = loadFixtures().filter((fx) => JSON.stringify(fx).includes("mock-slow-stream"));
    expect(users.length).toBeGreaterThan(0);
    for (const fx of users) expect(fx.id.startsWith("zz-")).toBe(true);
  });
});

describe("mock slow stream", () => {
  test("mock-slow-stream pauses after the first chunk for MOCK_STREAM_PAUSE_MS and then finishes", async () => {
    const previous = process.env.MOCK_STREAM_PAUSE_MS;
    process.env.MOCK_STREAM_PAUSE_MS = "250";
    cleanup.push(() => {
      if (previous === undefined) delete process.env.MOCK_STREAM_PAUSE_MS;
      else process.env.MOCK_STREAM_PAUSE_MS = previous;
    });
    const mock = await mockUp();
    const res = await post(mock.url, chat("mock-slow-stream", { stream: true }));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    const firstAt = Date.now();
    expect(first).toContain("data: {");
    let rest = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value);
    }
    expect(Date.now() - firstAt).toBeGreaterThanOrEqual(200);
    expect(rest).toContain("[DONE]");
  });
});

describe("compare-upstream by fixture", () => {
  const entry = (p, body = "x") => ({ method: "POST", path: p, headers: [["a", "1"]], bodyBase64: Buffer.from(body).toString("base64") });
  const writeRun = (dir, fixtures, { index = false } = {}) => {
    const all = [];
    const lines = [];
    for (const [id, reqs] of Object.entries(fixtures)) {
      lines.push({ id, from: all.length, to: all.length + reqs.length });
      all.push(...reqs);
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ status: 200, upstream: reqs.map((r) => ({ method: r.method, path: r.path })) }));
    }
    fs.writeFileSync(path.join(dir, "upstream-requests.jsonl"), all.map((r, seq) => `${JSON.stringify({ seq, ...r })}\n`).join(""));
    if (index) fs.writeFileSync(path.join(dir, "upstream-fixtures.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  };
  const base = () => ({ a: [entry("/1")], b: [], c: [entry("/3")], d: [entry("/4"), entry("/5")] });

  test("requests are grouped per fixture from the fixture outputs when no index exists", () => {
    const dir = tmp("parity-up-");
    writeRun(dir, base());
    const map = requestsByFixture(dir);
    expect([...map.keys()]).toEqual(["a", "b", "c", "d"]);
    expect(map.get("d").map((r) => r.path)).toEqual(["/4", "/5"]);
    expect(map.get("b")).toEqual([]);
  });

  test("requests are grouped per fixture from the index when one exists", () => {
    const dir = tmp("parity-up-");
    writeRun(dir, base(), { index: true });
    fs.rmSync(path.join(dir, "a.json"));
    expect(requestsByFixture(dir).get("c").map((r) => r.path)).toEqual(["/3"]);
  });

  test("an output whose upstream counts do not add up to the log is an error", () => {
    const dir = tmp("parity-up-");
    writeRun(dir, base());
    fs.appendFileSync(path.join(dir, "upstream-requests.jsonl"), `${JSON.stringify({ seq: 9, ...entry("/stray") })}\n`);
    expect(() => requestsByFixture(dir)).toThrow("account for");
  });

  test("one fixture making an extra request is one diff, not a shift of every later request", () => {
    const expected = tmp("parity-up-e-");
    const actual = tmp("parity-up-a-");
    writeRun(expected, base());
    writeRun(actual, { a: [entry("/1")], b: [entry("/extra")], c: [entry("/3")], d: [entry("/4"), entry("/5")] }, { index: true });
    const { diffs, unlisted } = compareUpstreamDirs(expected, actual);
    expect(diffs).toEqual([{ file: "b", path: "count", expected: 0, actual: 1, message: "request count: expected 0, actual 1" }]);
    expect(unlisted).toEqual(diffs);
  });

  test("a changed request is attributed to its fixture and position", () => {
    const expected = tmp("parity-up-e-");
    const actual = tmp("parity-up-a-");
    writeRun(expected, base());
    writeRun(actual, { ...base(), d: [entry("/4"), entry("/5", "changed")] });
    const { diffs } = compareUpstreamDirs(expected, actual);
    expect(diffs.map((d) => [d.file, d.path])).toEqual([["d", "[1].body"]]);
  });

  test("a known upstream diff is accepted while it matches, pinned values included, and reported stale once it stops occurring", () => {
    const expected = tmp("parity-up-e-");
    const actual = tmp("parity-up-a-");
    writeRun(expected, base());
    writeRun(actual, { ...base(), b: [entry("/extra")] });
    const known = [{ file: "b", path: "count", actual: 1, reason: "the loopback request now reaches the handler" }];
    expect(compareUpstreamDirs(expected, actual, [], known)).toMatchObject({ unlisted: [], stale: [] });
    const pinnedElsewhere = [{ ...known[0], actual: 2 }];
    const wrong = compareUpstreamDirs(expected, actual, [], pinnedElsewhere);
    expect(wrong.unlisted.map((d) => d.file)).toEqual(["b"]);
    expect(wrong.stale).toEqual(pinnedElsewhere);
    writeRun(actual, base());
    expect(compareUpstreamDirs(expected, actual, [], known).stale).toEqual(known);
  });

  test("the cli exits 0 when every diff is known and 1 for an unlisted one", () => {
    const script = path.join(import.meta.dir, "compare-upstream.mjs");
    const expected = tmp("parity-up-e-");
    const same = tmp("parity-up-s-");
    const actual = tmp("parity-up-a-");
    writeRun(expected, base());
    writeRun(same, base());
    writeRun(actual, { ...base(), a: [entry("/1"), entry("/more")] });
    const none = path.join(tmp("parity-known-"), "none.json");
    fs.writeFileSync(none, "[]");
    const known = path.join(tmp("parity-known-"), "known.json");
    fs.writeFileSync(known, JSON.stringify([{ file: "a", path: "count", actual: 2, reason: "the fixture makes one more request" }]));
    expect(Bun.spawnSync([process.execPath, script, expected, same, "--known", none]).exitCode).toBe(0);
    const bad = Bun.spawnSync([process.execPath, script, expected, actual, "--known", none]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("a request count: expected 1, actual 2");
    expect(Bun.spawnSync([process.execPath, script, expected, actual, "--known", known]).exitCode).toBe(0);
    expect(Bun.spawnSync([process.execPath, script, expected, same, "--known", known]).exitCode).toBe(1);
  });

  test("the committed expected goldens split into one request list per fixture", () => {
    const map = requestsByFixture(path.join(import.meta.dir, "expected"));
    expect(map.size).toBeGreaterThan(300);
    expect(map.get("v1-chat-combo-fallback").length).toBe(2);
  });

  test("known-upstream-diffs entries are valid", () => {
    const upstream = loadKnownUpstreamDiffs();
    expect([...new Set(upstream.map((k) => k.file))].sort()).toEqual([
      "api-v1-models-model-noauth",
      "api-v1-models-noauth",
      "api-v1-noauth",
    ]);
    expect(upstream.length).toBe(3);
    for (const k of upstream) {
      expect(fs.existsSync(path.join(import.meta.dir, "expected", `${k.file}.json`))).toBe(true);
      expect(k.path).toBe("count");
    }
  });
});

describe("record", () => {
  const encoder = new TextEncoder();
  const cutServer = () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const { pathname } = new URL(req.url);
        const type = pathname === "/sse" ? "text/event-stream" : "application/json";
        const first = pathname === "/sse" ? 'data: {"a":1}\n\n' : '{"partial":';
        const body = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(first));
            await Bun.sleep(30);
            controller.error(new Error("cut"));
          },
        });
        return new Response(body, { headers: { "content-type": type } });
      },
    });
    cleanup.push(() => server.stop(true));
    return server;
  };
  const fixture = (id, path, extra = {}) => ({ id, peer: "loopback", auth: "none", method: "GET", path, ...extra });

  test("record writes which upstream requests each fixture caused", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/hit") await fetch(`${mock.url}/v1/models`);
        if (pathname === "/hit2") {
          await fetch(`${mock.url}/v1/models`);
          await fetch(`${mock.url}/v1/models`);
        }
        return new Response("ok");
      },
    });
    cleanup.push(() => server.stop(true));
    const outDir = tmp("parity-idx-");
    const mock = await mockUp({ outDir });
    const fixtures = [fixture("idx-none", "/none"), fixture("idx-one", "/hit"), fixture("idx-two", "/hit2"), fixture("idx-after", "/none")];
    await record({ baseUrl: `http://127.0.0.1:${server.port}`, outDir, mock, fixtures });
    const index = fs.readFileSync(path.join(outDir, "upstream-fixtures.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(index).toEqual([
      { id: "idx-none", from: 0, to: 0 },
      { id: "idx-one", from: 0, to: 1 },
      { id: "idx-two", from: 1, to: 3 },
      { id: "idx-after", from: 3, to: 3 },
    ]);
    const map = requestsByFixture(outDir);
    expect([...map.entries()].map(([id, reqs]) => [id, reqs.length])).toEqual([["idx-none", 0], ["idx-one", 1], ["idx-two", 2], ["idx-after", 0]]);
  });

  test("record masks the data dir and normalises its path separators so Windows and Linux outputs match", async () => {
    const dataDir = path.join(tmp("parity-data-"), "d");
    const windowsPath = `${dataDir}\\nested\\model-catalog.json`;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ file: windowsPath }) });
    cleanup.push(() => server.stop(true));
    const outDir = tmp("parity-mask-");
    const mock = await mockUp({ outDir });
    await record({ baseUrl: `http://127.0.0.1:${server.port}`, outDir, mock, dataDir, fixtures: [fixture("masked", "/x")] });
    const out = JSON.parse(fs.readFileSync(path.join(outDir, "masked.json"), "utf8"));
    expect(out.body.file).toBe("<DATA_DIR>/nested/model-catalog.json");
  });

  test("a connection cut while reading the body is recorded, not thrown", async () => {
    const server = cutServer();
    const outDir = tmp("parity-cut-");
    const mock = await mockUp({ outDir });
    const fixtures = [fixture("cut-sse", "/sse", { sse: { maxFrames: 5, maxMs: 2000 } }), fixture("cut-json", "/json")];
    const { ids, unreachable } = await record({ baseUrl: `http://127.0.0.1:${server.port}`, outDir, mock, fixtures });
    expect(ids).toEqual(["cut-sse", "cut-json"]);
    expect(unreachable).toEqual([]);

    const sse = JSON.parse(fs.readFileSync(path.join(outDir, "cut-sse.json"), "utf8"));
    expect(sse).toEqual({ status: 200, headers: { "content-type": "text/event-stream" }, error: sse.error, framesSoFar: [{ data: '{"a":1}' }], upstream: [] });
    expect(["connection-reset", "body-read-failed"]).toContain(sse.error);

    const json = JSON.parse(fs.readFileSync(path.join(outDir, "cut-json.json"), "utf8"));
    expect(json).toEqual({ status: 200, headers: { "content-type": "application/json" }, error: json.error, framesSoFar: null, upstream: [] });
    expect(["connection-reset", "body-read-failed"]).toContain(json.error);
  });

  test("a cut recording differs from a clean one, so compare reports it", async () => {
    const server = cutServer();
    const outDir = tmp("parity-cut-");
    const mock = await mockUp({ outDir });
    await record({ baseUrl: `http://127.0.0.1:${server.port}`, outDir, mock, fixtures: [fixture("cut-json", "/json")] });
    const clean = tmp("parity-clean-");
    fs.writeFileSync(path.join(clean, "cut-json.json"), JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body: { partial: true }, upstream: [] }));
    expect(compareDirs(clean, outDir, []).unlisted.length).toBeGreaterThan(0);
  });

  test("a target that does not answer is recorded as status 0 and reported as unreachable", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    await server.stop(true);
    const outDir = tmp("parity-down-");
    const mock = await mockUp({ outDir });
    const { ids, unreachable } = await record({ baseUrl, outDir, mock, fixtures: [fixture("down", "/x")] });
    expect(ids).toEqual(["down"]);
    expect(unreachable).toEqual(["down"]);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "down.json"), "utf8")).status).toBe(0);
  });
});

describe("run", () => {
  test("run refuses to clear an output directory that holds other files", () => {
    const dir = tmp("parity-out-");
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const run = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "run.mjs"), "--target", "next", "--out", dir], { cwd: repoRoot });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain("refusing to clear");
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("keep me");
  });
});
