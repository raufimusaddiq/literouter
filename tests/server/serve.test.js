import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import os from "node:os";
import net from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-serve-");
const calls = mockBootCollaborators();
const guardFlags = { throwOnCompare: false };
vi.mock("@/shared/utils/safeEqual", () => ({
  safeEqual: (a, b) => {
    if (guardFlags.throwOnCompare) throw new Error("guard boom");
    const hash = (v) => createHash("sha256").update(String(v ?? "")).digest();
    return timingSafeEqual(hash(a), hash(b));
  },
}));

const { routeTable } = await import("../../src/server/routes.js");
const { startServer } = await import("../../src/server/index.js");
const { json } = await import("../../src/server/http.js");
const { getConsistentMachineId } = await import("@/shared/utils/machineId");
const { updateSettings } = await import("@/lib/db/index.js");

const originalLoads = new Map();
for (const entry of routeTable) {
  if (entry.path === "/api/health") continue;
  originalLoads.set(entry, entry.load);
  entry.load = async () =>
    Object.fromEntries(
      entry.methods.map((method) => [
        method,
        async (req, ctx) => json({ matched: entry.path, params: await ctx.params }),
      ]),
    );
}

const cliToken = await getConsistentMachineId("9r-cli-auth");
const auth = { "x-9r-cli-token": cliToken };

const concrete = (path) => path.replace(/:[A-Za-z]+/g, "id").replace(/\*$/, "a/b");

const servers = [];
let server;
let base;

function nonLoopbackIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}

function rawRequest(path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.port, "127.0.0.1");
    let data = "";
    socket.setTimeout(10_000, () => socket.destroy(new Error("raw request timed out")));
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
    });
    socket.on("error", reject);
    socket.on("close", () => {
      const [head] = data.split("\r\n\r\n");
      const lines = head.split("\r\n");
      const header = (name) => {
        const line = lines.find((l) => l.toLowerCase().startsWith(`${name}:`));
        return line ? line.slice(name.length + 1).trim() : null;
      };
      resolve({ status: Number(lines[0].split(" ")[1]), location: header("location"), refresh: header("refresh") });
    });
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  });
}

beforeAll(async () => {
  server = await startServer({
    port: 0,
    hostname: "0.0.0.0",
    routes: {
      "/__boom": () => {
        throw new Error("boom");
      },
      "/__headers": (req) => json({ headers: Object.fromEntries(req.headers) }),
    },
  });
  servers.push(server);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const [entry, load] of originalLoads) entry.load = load;
});

describe("startServer", () => {
  it("serves a /api route through the guard", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("unauthenticated /api/settings is 401", async () => {
    const res = await fetch(`${base}/api/settings`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("every routeTable path answers (not a Bun 404) for its first method", async () => {
    const failures = [];
    for (const entry of routeTable) {
      if (entry.path === "/api/health") continue;
      const method = entry.methods[0];
      const res = await fetch(`${base}${concrete(entry.path)}`, {
        method,
        headers: auth,
        body: method === "GET" || method === "HEAD" || method === "OPTIONS" ? undefined : "{}",
        signal: AbortSignal.timeout(10_000),
      });
      const type = res.headers.get("content-type") || "";
      if (method === "HEAD" || method === "OPTIONS") {
        if (res.status === 404) failures.push(`${method} ${entry.path} -> 404`);
        continue;
      }
      if (res.status !== 200 || !type.includes("application/json")) {
        failures.push(`${method} ${entry.path} -> ${res.status} ${type}`);
        continue;
      }
      const body = await res.json();
      if (body.matched !== entry.path) failures.push(`${method} ${entry.path} matched ${body.matched}`);
    }
    expect(failures).toEqual([]);
  });

  it("unknown /api path returns the recorded 404 page", async () => {
    const res = await fetch(`${base}/api/nope`, { headers: auth });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-cache, no-store, max-age=0, must-revalidate");
    const html = await res.text();
    expect(/<title>([^<]*)<\/title>/.exec(html)[1]).toBe("LiteRouter — AI routing control plane");
    expect(html).toContain("<title>404: This page could not be found.</title>");
  });

  it("unknown /api path without credentials is 401, like the recorded response", async () => {
    const res = await fetch(`${base}/api/nope`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(res.status).toBe(401);
  });

  it("trailing slash /api/keys/ behaves like the recorded Next response", async () => {
    const res = await fetch(`${base}/api/keys/`, { redirect: "manual", headers: auth });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/api/keys");
    expect(await res.text()).toBe("/api/keys");
  });

  it("guard redirects use a relative Location and carry the target as the body, like Next", async () => {
    const root = await fetch(`${base}/`, { redirect: "manual" });
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe("/dashboard");
    expect(await root.text()).toBe("/dashboard");
    const dash = await fetch(`${base}/dashboard`, { redirect: "manual" });
    expect(dash.status).toBe(307);
    expect(dash.headers.get("location")).toBe("/login");
    expect(await dash.text()).toBe("/login");
  });

  it("trailing slash redirects keep the query string and apply to catch-all, non-api and POST", async () => {
    const a = await fetch(`${base}/api/v1/models/?x=1`, { redirect: "manual", headers: auth });
    expect(a.status).toBe(308);
    expect(a.headers.get("location")).toBe("/api/v1/models?x=1");
    const b = await fetch(`${base}/v1/models/`, { redirect: "manual", headers: auth });
    expect(b.status).toBe(308);
    expect(b.headers.get("location")).toBe("/v1/models");
    const c = await fetch(`${base}/api/keys/`, { method: "POST", redirect: "manual", headers: auth, body: "{}" });
    expect(c.status).toBe(308);
  });

  it("trailing slash redirects never emit a protocol-relative Location", async () => {
    const cases = [
      ["//evil.com/", "/evil.com"],
      ["///evil.com//", "/evil.com/"],
      ["////evil.com/path/?q=1", "/evil.com/path?q=1"],
      ["//", "/"],
    ];
    for (const [path, expected] of cases) {
      const res = await rawRequest(path);
      expect(res.status).toBe(308);
      expect(res.location).toBe(expected);
      expect(res.location).toMatch(/^\/(?![/\\])|^\/$/);
      expect(res.refresh).toBe(`0;url=${expected}`);
    }
  });

  it("a backslash-prefixed path cannot redirect off-origin either", async () => {
    for (const path of ["/\\evil.com/", "/\\/evil.com/", "\\\\evil.com/"]) {
      const res = await rawRequest(path);
      if (res.status === 308) {
        expect(res.location).toMatch(/^\/(?![/\\])/);
        expect(res.location).not.toContain("\\");
      } else {
        expect(res.location).toBeNull();
      }
    }
  });

  it("a guard that throws returns 500 and the next request still works", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    guardFlags.throwOnCompare = true;
    let boom;
    try {
      boom = await fetch(`${base}/api/keys`, { headers: auth });
    } finally {
      guardFlags.throwOnCompare = false;
      errors.mockRestore();
    }
    expect(boom.status).toBe(500);
    expect(await boom.text()).toBe("");
    const after = await fetch(`${base}/api/keys`, { headers: auth });
    expect(after.status).toBe(200);
    expect((await after.json()).matched).toBe("/api/keys");
  });

  it("a handler that throws returns 500 and the next request still works", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const boom = await fetch(`${base}/__boom`);
    errors.mockRestore();
    expect(boom.status).toBe(500);
    const after = await fetch(`${base}/api/health`);
    expect(after.status).toBe(200);
  });

  it("x-9r-* and x-forwarded-for are stripped before handlers", async () => {
    const res = await fetch(`${base}/__headers`, {
      headers: {
        "x-9r-real-ip": "10.9.9.9",
        "x-9r-peer-token": "forged",
        "x-9r-via-proxy": "1",
        "x-forwarded-for": "203.0.113.9",
        "x-keep": "yes",
      },
    });
    const { headers } = await res.json();
    expect(headers["x-9r-real-ip"]).toBeUndefined();
    expect(headers["x-9r-peer-token"]).toBeUndefined();
    expect(headers["x-9r-via-proxy"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-keep"]).toBe("yes");
  });

  it("an unmatched non-api path falls through to a 404", async () => {
    const res = await fetch(`${base}/definitely-not-a-file.xyz`);
    expect(res.status).toBe(404);
  });

  it("startServer twice in one process boots once", async () => {
    const sharedBoot = globalThis.__lrBoot;
    expect(sharedBoot).toBeInstanceOf(Promise);
    const second = await startServer({ port: 0, hostname: "127.0.0.1" });
    servers.push(second);
    expect(globalThis.__lrBoot).toBe(sharedBoot);
    expect(second.port).not.toBe(server.port);
    expect(calls.warn).toHaveBeenCalledTimes(1);
    expect(calls.consoleCapture).toHaveBeenCalledTimes(1);
    expect(calls.catalog).toHaveBeenCalledTimes(1);
    expect(calls.modelSync).toHaveBeenCalledTimes(1);
    expect(calls.bootstrap).toHaveBeenCalledTimes(1);
    expect(calls.outboundProxy).toHaveBeenCalledTimes(1);
  });
});

describe("real-socket trust", () => {
  const target = "/api/auth/reset-password";
  const lanIp = nonLoopbackIPv4();

  beforeAll(async () => {
    await updateSettings({ requireLogin: false });
  });

  afterAll(async () => {
    await updateSettings({ requireLogin: true });
    delete process.env.TRUST_LOOPBACK_AS_LOCAL;
  });

  const post = (url, headers = {}) => fetch(url, { method: "POST", headers, body: "{}" });

  it("direct loopback with a CLI token is allowed", async () => {
    expect((await post(`${base}${target}`, auth)).status).toBe(200);
  });

  it("direct loopback without a token is allowed as local", async () => {
    expect((await post(`${base}${target}`)).status).toBe(200);
  });

  it("direct loopback with X-Forwarded-For and no token is 403", async () => {
    expect((await post(`${base}${target}`, { "x-forwarded-for": "203.0.113.9" })).status).toBe(403);
  });

  it("direct loopback with X-Forwarded-For and a CLI token is allowed by the token", async () => {
    expect((await post(`${base}${target}`, { ...auth, "x-forwarded-for": "203.0.113.9" })).status).toBe(200);
  });

  it.skipIf(!lanIp)("a spoofed x-9r-real-ip from a non-loopback peer is still 403", async () => {
    const url = `http://${lanIp}:${server.port}${target}`;
    expect((await post(url, { "x-9r-real-ip": "127.0.0.1" })).status).toBe(403);
    expect((await post(url, { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "forged" })).status).toBe(403);
  });

  it("TRUST_LOOPBACK_AS_LOCAL=false makes loopback remote", async () => {
    process.env.TRUST_LOOPBACK_AS_LOCAL = "false";
    try {
      expect((await post(`${base}${target}`)).status).toBe(403);
    } finally {
      delete process.env.TRUST_LOOPBACK_AS_LOCAL;
    }
  });
});
