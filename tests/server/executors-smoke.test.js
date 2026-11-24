import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { vi } from "#test/vi";
import { useTempDataDirAtLoad } from "#test/tempDataDir";

useTempDataDirAtLoad("executors-smoke-");

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(async () => ({ key: "auto", max_output_tokens: 32 })),
  resolveQoderModels: vi.fn(),
  isQoderPat: (token) => String(token || "").startsWith("pt-"),
  resolveQoderCredentials: vi.fn(),
}));

const realFetch = globalThis.fetch;
const redirects = new Map();
globalThis.fetch = (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const to = redirects.get(target);
  return realFetch(to ?? input, init);
};

const {
  compress,
  concatBytes,
  eventStreamFrame,
  startExecutorMock,
  startH2Mock,
  TLS_DIR,
} = await import("./helpers/executor-mock.js");
const { anthropicCompatibleCase, cases, chatBody, cursorAgentFrames, cursorLegacyFrames } = await import("./helpers/executor-cases.js");
const { PROVIDERS, PROVIDER_OAUTH } = await import("../../open-sse/config/providers.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");
const { ACCEPT_ENCODING } = await import("../../open-sse/utils/zstdCompat.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { __test__: mimoInternals } = await import("../../open-sse/executors/mimo-free.js");

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const env = { PROVIDERS, PROVIDER_OAUTH };
const redirectSources = {
  "grok-web": PROVIDERS["grok-web"].baseUrl,
  "perplexity-web": PROVIDERS["perplexity-web"].baseUrl,
};

let mock;
let h2;
let devin;
let originalHttp2ConnectOptions;
const originalDevinEnv = {
  CLI_DEVIN_BIN: process.env.CLI_DEVIN_BIN,
  DEVIN_STUB_LOG: process.env.DEVIN_STUB_LOG,
};

function writeDevinStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devin-stub-"));
  const script = path.join(dir, "fake-devin.js");
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(script, `
import fs from "node:fs";
import readline from "node:readline";
const log = process.env.DEVIN_STUB_LOG;
fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method) fs.appendFileSync(log, JSON.stringify({ method: msg.method, params: msg.params }) + "\\n");
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
  else if (msg.method === "session/new") send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "stub-session" } });
  else if (msg.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "stub-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "devin-cli-ok" } } } });
    send({ jsonrpc: "2.0", method: "_cognition.ai/agent_stopped", params: { cause: "complete" } });
  }
});
`);
  let bin;
  if (process.platform === "win32") {
    bin = path.join(dir, "fake-devin.cmd");
    fs.writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    bin = path.join(dir, "fake-devin");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }
  return { dir, bin, log };
}

beforeAll(async () => {
  const cursorExecutor = getExecutor("cursor");
  originalHttp2ConnectOptions = cursorExecutor.http2ConnectOptions;
  cursorExecutor.http2ConnectOptions = { ca: fs.readFileSync(path.join(TLS_DIR, "cert.pem")) };
  mock =await startExecutorMock();
  h2 = await startH2Mock();
  mock.h2 = h2;
  devin = writeDevinStub();
  process.env.CLI_DEVIN_BIN = devin.bin;
  process.env.DEVIN_STUB_LOG = devin.log;
  redirectSources.mimoBootstrap = mimoInternals.BOOTSTRAP_URL;
});

afterAll(async () => {
  await mock.stop();
  await h2.stop();
  fs.rmSync(devin.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  getExecutor("cursor").http2ConnectOptions = originalHttp2ConnectOptions;
  for (const [key, value] of Object.entries(originalDevinEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

afterEach(() => {
  redirects.clear();
  mock.reset();
  h2.reset();
});

function resolveCredentials(c) {
  return typeof c.credentials === "function" ? c.credentials(mock) : structuredClone(c.credentials);
}

function armRedirect(c) {
  if (!c.redirect) return;
  const from = c.redirect.bootstrap ? redirectSources.mimoBootstrap : redirectSources[c.redirect.provider];
  redirects.set(from, `${mock.url}${c.redirect.to}`);
}

async function execute(c, overrides = {}) {
  c.mock?.(mock);
  armRedirect(c);
  const executor = getExecutor(c.executorKey ?? c.provider);
  const savedConfig = executor.config;
  const restore = c.prepare?.(executor, mock, env);
  const controller = new AbortController();
  try {
    const result = await executor.execute({
      model: c.model,
      body: structuredClone(c.body),
      stream: c.stream ?? true,
      credentials: resolveCredentials(c),
      signal: controller.signal,
      log: silentLog,
      ...overrides,
    });
    const text = await (c.decode ? c.decode(result.response) : result.response.text());
    result.dispose?.();
    return { result, text };
  } finally {
    restore?.();
    delete executor.buildUrl;
    delete executor.base;
    executor.config = savedConfig;
  }
}

function seenHeaders(c) {
  if (c.transport === "h2") return h2.requests.at(-1)?.headers;
  return mock.requests.find((r) => r.path === c.path)?.headers;
}

describe("executor case table", () => {
  test("case table covers every executor factory key plus default", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../open-sse/executors/index.js"), "utf8");
    const block = source.match(/const factories = \{([\s\S]*?)\n\};/)[1];
    const keys = [...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z0-9_]+)):\s*\(\)\s*=>/gm)].map((m) => m[1] ?? m[2]);
    expect(keys).toHaveLength(26);
    const covered = cases.map((c) => c.provider);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual([...keys, "default"].sort());
    expect(cases).toHaveLength(27);
  });
});

describe("executors against the mock upstream", () => {
  test.each(cases.map((c) => [c.provider, c]))("%p executor round-trips against the mock upstream", async (_provider, c) => {
    if (c.transport === "stdio") {
      const { result, text } = await execute(c);
      expect(result.response.status).toBe(200);
      expect(text).toContain(c.expectText);
      const calls = fs.readFileSync(devin.log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(calls.some((call) => call.argv?.[0] === "acp")).toBe(true);
      const prompt = calls.find((call) => call.method === "session/prompt");
      expect(JSON.stringify(prompt.params.prompt)).toContain("ping");
      return;
    }

    const { result, text } = await execute(c);
    expect(result.response.status).toBe(200);
    expect(text).toContain(c.expectText);

    if (c.transport === "h2") {
      expect(h2.requests).toHaveLength(1);
      expect(h2.requests[0].headers[":path"]).toBe(c.path);
    } else {
      expect(mock.requests.some((r) => r.path === c.path)).toBe(true);
    }

    const headers = seenHeaders(c);
    expect(headers).toBeDefined();
    if (c.auth) expect(headers[c.auth.header]).toMatch(c.auth.pattern);
    for (const [name, pattern] of Object.entries(c.extraHeaders ?? {})) expect(headers[name]).toMatch(pattern);
  });

  test("anthropic-compatible provider round-trips an Anthropic SSE stream", async () => {
    const c = anthropicCompatibleCase;
    const { result, text } = await execute(c);
    expect(result.response.status).toBe(200);
    expect(text).toContain(c.expectText);
    const seen = mock.requests.find((r) => r.path === c.path);
    expect(seen.headers[c.auth.header]).toMatch(c.auth.pattern);
    expect(seen.headers["anthropic-version"]).toBeTruthy();
  });
});

describe("binary wire formats", () => {
  test("kiro EventStream decodes to text", async () => {
    const frames = concatBytes([
      eventStreamFrame("assistantResponseEvent", { content: "kiro " }),
      eventStreamFrame("assistantResponseEvent", { content: "decoded" }),
      eventStreamFrame("meteringEvent", { usage: 2, unit: "credit" }),
    ]);
    const c = cases.find((x) => x.provider === "kiro");
    mock.on("POST", "/kiro/generateAssistantResponse", () => new Response(new ReadableStream({
      async start(controller) {
        for (let offset = 0; offset < frames.length; offset += 9) {
          controller.enqueue(frames.slice(offset, offset + 9));
          await Bun.sleep(1);
        }
        controller.close();
      },
    }), { headers: { "content-type": "application/vnd.amazon.eventstream" } }));
    const executor = getExecutor("kiro");
    executor.buildUrl = () => `${mock.url}/kiro/generateAssistantResponse`;
    try {
      const { response } = await executor.execute({ model: c.model, body: structuredClone(c.body), stream: true, credentials: resolveCredentials(c), log: silentLog });
      const text = await response.text();
      expect(text).toContain('"content":"kiro "');
      expect(text).toContain('"content":"decoded"');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text).toContain('"kiro_credits":2');
      expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    } finally {
      delete executor.buildUrl;
    }
  });

  test("commandcode NDJSON decodes to text", async () => {
    const lines = [
      { type: "text-delta", text: "command" },
      { type: "text-delta", text: "code decoded" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 3, outputTokens: 2 } },
    ].map((line) => `${JSON.stringify(line)}\n`).join("");
    mock.on("POST", "/commandcode/alpha/generate", () => new Response(new ReadableStream({
      async start(controller) {
        const bytes = new TextEncoder().encode(lines);
        for (let offset = 0; offset < bytes.length; offset += 11) {
          controller.enqueue(bytes.slice(offset, offset + 11));
          await Bun.sleep(1);
        }
        controller.close();
      },
    }), { headers: { "content-type": "application/x-ndjson" } }));
    const executor = getExecutor("commandcode");
    executor.buildUrl = () => `${mock.url}/commandcode/alpha/generate`;
    try {
      const { response } = await executor.execute({ model: "claude-sonnet-4-5", body: chatBody("claude-sonnet-4-5"), stream: true, credentials: { apiKey: "cc-key" }, log: silentLog });
      const text = await response.text();
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(text).toContain('"content":"command"');
      expect(text).toContain('"content":"code decoded"');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    } finally {
      delete executor.buildUrl;
    }
  });

  test("cursor over node:http2 streams a protobuf response", async () => {
    const c = cases.find((x) => x.provider === "cursor");
    let firstWriteAt = 0;
    let secondWriteAt = 0;
    h2.handle((stream) => {
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
      const frames = cursorAgentFrames("cursor streamed");
      const split = frames.length - 12;
      stream.write(Buffer.from(frames.slice(0, split)));
      firstWriteAt = performance.now();
      setTimeout(() => {
        secondWriteAt = performance.now();
        stream.write(Buffer.from(frames.slice(split)));
        stream.end();
      }, 120);
    });
    const executor = getExecutor("cursor");
    const restore = c.prepare(executor, mock, env);
    try {
      const { response } = await executor.execute({ model: c.model, body: chatBody(c.model), stream: true, credentials: resolveCredentials(c), log: silentLog });
      expect(response.status).toBe(200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let firstChunkAt = 0;
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstChunkAt) firstChunkAt = performance.now();
        text += decoder.decode(value, { stream: true });
      }
      expect(text).toContain("cursor streamed");
      expect(text).toContain('"finish_reason":"stop"');
      expect(firstWriteAt).toBeGreaterThan(0);
      expect(secondWriteAt).toBeGreaterThan(firstWriteAt);
      const request = h2.requests[0];
      expect(request.headers[":method"]).toBe("POST");
      expect(request.headers[":path"]).toBe("/agent.v1.AgentService/Run");
      expect(request.headers.authorization).toBe("Bearer cursor-token");
      expect(Buffer.concat(request.chunks).length).toBeGreaterThan(5);
    } finally {
      restore();
    }
  });

  test("cursor legacy ChatService path decodes a protobuf frame over node:http2", async () => {
    const c = cases.find((x) => x.provider === "cursor");
    h2.handle((stream) => {
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
      stream.end(Buffer.from(cursorLegacyFrames("cursor legacy ok")));
    });
    const executor = getExecutor("cursor");
    executor.buildUrl = () => `${h2.url}/aiserver.v1.ChatService/StreamUnifiedChatWithTools`;
    const body = {
      model: c.model,
      stream: true,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "text", text: "ping" }] }],
    };
    try {
      const { response } = await executor.execute({ model: c.model, body, stream: true, credentials: resolveCredentials(c), log: silentLog });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("cursor legacy ok");
      expect(h2.requests[0].headers[":path"]).toBe("/aiserver.v1.ChatService/StreamUnifiedChatWithTools");
    } finally {
      delete executor.buildUrl;
    }
  });
});

describe("content encodings", () => {
  test("ACCEPT_ENCODING advertises zstd exactly when the runtime can decode it", async () => {
    mock.on("GET", "/enc/zstd", () => new Response(compress("zstd", "probe-zstd"), { headers: { "content-encoding": "zstd", "content-type": "text/plain" } }));
    const response = await realFetch(`${mock.url}/enc/zstd`, { headers: { "accept-encoding": "zstd" } });
    const decoded = (await response.text()) === "probe-zstd";
    expect(ACCEPT_ENCODING.split(/,\s*/).includes("zstd")).toBe(decoded);
    expect(typeof zlib.createZstdDecompress === "function").toBe(decoded);
    for (const required of ["gzip", "deflate", "br"]) expect(ACCEPT_ENCODING).toContain(required);
  });

  test.each(["zstd", "br", "gzip"])("%p body from the mock decodes through proxyAwareFetch", async (encoding) => {
    mock.on("POST", `/enc/${encoding}`, () => new Response(compress(encoding, `payload-${encoding}`), { headers: { "content-encoding": encoding, "content-type": "text/plain" } }));
    const response = await proxyAwareFetch(`${mock.url}/enc/${encoding}`, { method: "POST", headers: { "accept-encoding": ACCEPT_ENCODING }, body: "{}" });
    expect(await response.text()).toBe(`payload-${encoding}`);
    expect(mock.last(`/enc/${encoding}`).headers["accept-encoding"]).toBe(ACCEPT_ENCODING);
  });
});

describe("abort handling", () => {
  test("default executor aborts promptly on signal", async () => {
    let upstreamSocketClosed = false;
    mock.on("POST", "/abort/default", (_entry, req) => {
      req.signal.addEventListener("abort", () => { upstreamSocketClosed = true; });
      return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    });
    const executor = getExecutor("openai");
    executor.buildUrl = () => `${mock.url}/abort/default`;
    const controller = new AbortController();
    try {
      const started = performance.now();
      setTimeout(() => controller.abort(), 100);
      const outcome = await executor.execute({ model: "gpt-4o-mini", body: chatBody("gpt-4o-mini"), stream: true, credentials: { apiKey: "sk-abort" }, signal: controller.signal, log: silentLog })
        .then(
          async (result) => {
            await result.response.text();
            return { error: null };
          },
          (error) => ({ error }),
        );
      expect(performance.now() - started).toBeLessThan(2000);
      expect(outcome.error?.name).toBe("AbortError");
      await Bun.sleep(100);
      expect(upstreamSocketClosed).toBe(true);
    } finally {
      delete executor.buildUrl;
    }
  });

  test("cursor executor aborts promptly on signal", async () => {
    const c = cases.find((x) => x.provider === "cursor");
    let streamClosed = false;
    h2.handle((stream) => {
      stream.on("close", () => { streamClosed = true; });
    });
    const executor = getExecutor("cursor");
    const restore = c.prepare(executor, mock, env);
    const controller = new AbortController();
    try {
      const started = performance.now();
      setTimeout(() => controller.abort(), 100);
      const outcome = await executor.execute({ model: c.model, body: chatBody(c.model), stream: true, credentials: resolveCredentials(c), signal: controller.signal, log: silentLog })
        .then(
          async (result) => {
            await result.response.text();
            return { status: result.response.status };
          },
          (error) => ({ error }),
        );
      expect(performance.now() - started).toBeLessThan(2000);
      expect(outcome.error).toBeUndefined();
      expect(outcome.status).toBe(500);
      await Bun.sleep(100);
      expect(streamClosed).toBe(true);
    } finally {
      restore();
    }
  });
});
