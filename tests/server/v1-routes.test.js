import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "../helpers/tempDataDir.js";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

useTempDataDirAtLoad("lr-v1-routes-");
mockBootCollaborators();

const realChildProcess = await import("node:child_process");
const hostToolMissing = () => {
  throw new Error("host tool lookup stubbed");
};
vi.mock("child_process", () => ({ ...realChildProcess, execSync: hostToolMissing, execFileSync: hostToolMissing }));

const chatCalls = [];
vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: async (request) => {
    const text = await request.text();
    chatCalls.push({ pathname: new URL(request.url).pathname, method: request.method, body: text ? JSON.parse(text) : null });
    return Response.json({
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: "mock",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    });
  },
}));

const { startServer } = await import("../../src/server/index.js");
const { updateSettings } = await import("../../src/lib/db/index.js");

let server;
let base;
let upstream;
const upstreamSeen = [];
const upstreamHeaders = [];
let nextOctet = 10;

const remote = () => ({ "x-forwarded-for": `203.0.113.${nextOctet++}` });
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      upstreamSeen.push({ method: req.method, pathname: url.pathname, search: url.search, body: await req.text() });
      upstreamHeaders.push(Object.fromEntries(req.headers));
      if (url.pathname === "/hop") {
        return new Response("hop", {
          headers: { "keep-alive": "timeout=5", "proxy-authenticate": 'Basic realm="x"', "x-kept": "yes" },
        });
      }
      if (url.pathname === "/dashboard") {
        return new Response("<script>fetch('/stats');fetch('/health')</script>", {
          headers: { "content-type": "text/html; charset=utf-8", "x-upstream": "yes" },
        });
      }
      return Response.json({ ok: true, path: url.pathname });
    },
  });
  await updateSettings({ requireLogin: false, headroomUrl: `http://127.0.0.1:${upstream.port}` });
  server = await startServer({ port: 0, hostname: "127.0.0.1" });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  upstream.stop(true);
});

beforeEach(() => {
  chatCalls.length = 0;
  upstreamSeen.length = 0;
  upstreamHeaders.length = 0;
});

describe("v1 routes", () => {
  it("/v1/chat/completions, /v1/v1/chat/completions and /api/v1/chat/completions all reach the same handler", async () => {
    for (const path of ["/v1/chat/completions", "/v1/v1/chat/completions", "/api/v1/chat/completions"]) {
      const res = await post(path, { model: "mock", messages: [{ role: "user", content: "x" }] });
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe("chatcmpl-mock");
    }
    expect(chatCalls.map((c) => c.pathname)).toEqual(["/v1/chat/completions", "/v1/v1/chat/completions", "/api/v1/chat/completions"]);
    expect(chatCalls.every((c) => c.method === "POST" && c.body.model === "mock")).toBe(true);
  });

  it("/codex/responses and /responses reach api/v1/responses", async () => {
    for (const path of ["/codex/responses", "/responses", "/api/v1/responses"]) {
      const res = await post(path, { model: "mock", input: "x" });
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe("chatcmpl-mock");
    }
    expect(chatCalls.map((c) => c.pathname)).toEqual(["/codex/responses", "/responses", "/api/v1/responses"]);
    const options = await fetch(`${base}/responses`, { method: "OPTIONS" });
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("/v1/models/:kind and /v1/models/a/b/c (catch-all) resolve", async () => {
    const kind = await fetch(`${base}/v1/models/embedding`);
    expect(kind.status).toBe(200);
    expect((await kind.json()).object).toBe("list");
    expect(kind.headers.get("access-control-allow-origin")).toBe("*");

    const unknownKind = await fetch(`${base}/v1/models/nope`);
    expect(unknownKind.status).toBe(404);
    expect((await unknownKind.json()).error.message).toContain("Unknown model kind: nope");

    const nested = await fetch(`${base}/v1/models/a/b/c`);
    expect(nested.status).toBe(404);
    expect((await nested.json()).error.message).toBe("The model 'a/b/c' does not exist or you do not have access to it.");

    const queryKind = await fetch(`${base}/v1/models/a/b/c?kind=embedding`);
    expect(queryKind.status).toBe(200);
    expect((await queryKind.json()).object).toBe("list");

    const listKind = await fetch(`${base}/v1/models?kind=embedding`);
    expect(listKind.status).toBe(200);
    expect((await listKind.json()).object).toBe("list");
  });

  it("/v1/models honours the anthropic-version query parameters", async () => {
    const res = await fetch(`${base}/v1/models?limit=1`, { headers: { "anthropic-version": "2023-06-01" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(body).toHaveProperty("has_more");
  });

  it("/v1beta/models/gemini:generateContent resolves the catch-all as one segment", async () => {
    const res = await post("/v1beta/models/gemini:generateContent", { contents: [{ role: "user", parts: [{ text: "x" }] }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates[0].content.parts[0].text).toBe("hi");
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].pathname).toBe("/v1beta/models/gemini:generateContent");
    expect(chatCalls[0].body.model).toBe("gemini");

    const withProvider = await post("/v1beta/models/openai/gpt-x:generateContent", { contents: [{ role: "user", parts: [{ text: "x" }] }] });
    expect(withProvider.status).toBe(200);
    expect(chatCalls[1].pathname).toBe("/v1beta/models/openai/gpt-x:generateContent");
    expect(chatCalls[1].body.model).toBe("openai/gpt-x");
  });
});

describe("headroom and pxpipe", () => {
  it("headroom/proxy/[...path] forwards the rest of the path", async () => {
    const res = await fetch(`${base}/api/headroom/proxy/stats/history?window=5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: "/stats/history" });
    expect(upstreamSeen).toEqual([{ method: "GET", pathname: "/stats/history", search: "?window=5", body: "" }]);

    const posted = await post("/api/headroom/proxy/transformations/feed", { a: 1 });
    expect(posted.status).toBe(200);
    expect(upstreamSeen[1]).toEqual({ method: "POST", pathname: "/transformations/feed", search: "", body: '{"a":1}' });
  });

  it("headroom/proxy rewrites the dashboard html and keeps the other upstream headers", async () => {
    const res = await fetch(`${base}/api/headroom/proxy/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-upstream")).toBe("yes");
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toBe("<script>fetch('/api/headroom/proxy/stats');fetch('/api/headroom/proxy/health')</script>");
  });

  it("headroom/proxy drops hop-by-hop headers from the response and from the forwarded request", async () => {
    const res = await fetch(`${base}/api/headroom/proxy/hop`, {
      headers: { "keep-alive": "timeout=9", "proxy-authorization": "Basic abc", te: "trailers", "x-forwarded-thing": "kept" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hop");
    expect(res.headers.get("x-kept")).toBe("yes");
    expect(res.headers.get("keep-alive")).toBeNull();
    expect(res.headers.get("proxy-authenticate")).toBeNull();
    expect(upstreamSeen).toHaveLength(1);
    const forwarded = upstreamHeaders[0];
    expect(forwarded["x-forwarded-thing"]).toBe("kept");
    expect(forwarded["keep-alive"]).toBeUndefined();
    expect(forwarded["proxy-authorization"]).toBeUndefined();
    expect(forwarded.te).toBeUndefined();
  });

  it("headroom/proxy reports an unreachable upstream as a 500 json error", async () => {
    await updateSettings({ headroomUrl: "ftp://127.0.0.1:1" });
    try {
      const res = await fetch(`${base}/api/headroom/proxy/stats`);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("Headroom URL must use http or https");
    } finally {
      await updateSettings({ headroomUrl: `http://127.0.0.1:${upstream.port}` });
    }
  });

  it("headroom and pxpipe localhost-only routes are 403 for a proxied request", async () => {
    const targets = [
      ["POST", "/api/headroom/start"],
      ["POST", "/api/headroom/stop"],
      ["POST", "/api/headroom/restart"],
      ["GET", "/api/headroom/proxy/stats"],
      ["POST", "/api/headroom/extras"],
      ["POST", "/api/pxpipe/install"],
      ["POST", "/api/pxpipe/start"],
    ];
    for (const [method, path] of targets) {
      const res = await fetch(`${base}${path}`, { method, headers: remote(), body: method === "POST" ? "{}" : undefined });
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    expect(upstreamSeen).toHaveLength(0);
  });

  it("pxpipe and headroom status routes answer 200 json with their documented shape from loopback", async () => {
    const shapes = {
      "/api/pxpipe/status": ["installed", "running", "enabled", "mode"],
      "/api/pxpipe/stats": ["windows", "timeline", "recent"],
      "/api/pxpipe/health": ["healthy", "checks"],
      "/api/headroom/status": ["installed", "running", "url", "extras"],
    };
    for (const [path, keys] of Object.entries(shapes)) {
      const res = await fetch(`${base}${path}`);
      expect([path, res.status]).toEqual([path, 200]);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      for (const key of keys) expect([path, key, key in body]).toEqual([path, key, true]);
    }
  });
});
