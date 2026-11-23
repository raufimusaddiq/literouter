import { describe, test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMockUpstream } from "./mock-upstream.js";
import { normalizeBody, normalizeHeaders, normalizeSse, maskRetryAfter } from "./normalize.js";
import { compareDirs, diffValues } from "./compare.mjs";
import { compareUpstream } from "./compare-upstream.mjs";

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
    expect(normalizeHeaders(headers)).toEqual({
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-type": "application/json",
      "retry-after": "7",
      "set-cookie": ["auth_token=<MASKED>; Path=/; Expires=<DATE>; Max-Age=86400; HttpOnly; SameSite=lax"],
    });
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
    const bad = Bun.spawnSync(["bun", script, expected, actual]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("DIFF a status");
    expect(Bun.spawnSync(["bun", script, expected, same]).exitCode).toBe(0);
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
    const run = Bun.spawnSync(["bun", path.join(import.meta.dir, "seed.mjs"), dir, "--upstream", "http://127.0.0.1:1234", "--print-key"], { cwd: repoRoot });
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

const fixtureFiles = () => fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".json") && f !== "seed.json" && f !== "coverage.json");
const loadFixtures = () => fixtureFiles().map((f) => JSON.parse(fs.readFileSync(path.join(fixtureDir, f), "utf8")));

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
    for (const name of fixtureFiles()) {
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
