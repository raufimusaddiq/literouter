// T-39: protocol compatibility — Gemini /v1beta tools, max_completion_tokens,
// stop/params mapping, per-protocol error shapes, Anthropic model list.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(), getSettings: vi.fn(), isValidApiKey: vi.fn(),
  getProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials, isValidApiKey: mocks.isValidApiKey,
  markAccountUnavailable: mocks.markAccountUnavailable, clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiCompletionToGemini } from "../../open-sse/translator/response/openai-to-gemini.js";
import { RequestParamError } from "../../open-sse/translator/concerns/requestParams.js";
import { adjustMaxTokens } from "../../open-sse/translator/formats/maxTokens.js";
import {
  buildErrorBody, errorResponse, reshapeErrorResponse, resolveErrorFormat, unavailableResponse,
} from "../../open-sse/utils/error.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { toAnthropicModelList } from "../../open-sse/utils/anthropicModels.js";
import { POST } from "../../src/app/api/v1beta/models/[...path]/route.js";

const tr = (src, dst, body, model = "m") =>
  translateRequest(src, dst, model, structuredClone(body), false, null, null);

const TOOL = { type: "function", function: { name: "get_weather", description: "d", parameters: { type: "object", properties: { c: { type: "string" } } } } };

describe("max_completion_tokens", () => {
  it("adjustMaxTokens prefers max_completion_tokens", () => {
    expect(adjustMaxTokens({ max_completion_tokens: 777, max_tokens: 5000 })).toBe(777);
  });
  it("reaches Claude max_tokens", () => {
    expect(tr(FORMATS.OPENAI, FORMATS.CLAUDE, { messages: [{ role: "user", content: "hi" }], max_completion_tokens: 321 }).max_tokens).toBe(321);
  });
  it("reaches Gemini maxOutputTokens", () => {
    const out = tr(FORMATS.OPENAI, FORMATS.GEMINI, { messages: [{ role: "user", content: "hi" }], max_completion_tokens: 321 });
    expect(out.generationConfig.maxOutputTokens).toBe(321);
  });
});

describe("stop sequences", () => {
  const base = { messages: [{ role: "user", content: "hi" }] };
  it("OpenAI stop string/array -> Claude stop_sequences", () => {
    expect(tr(FORMATS.OPENAI, FORMATS.CLAUDE, { ...base, stop: "END" }).stop_sequences).toEqual(["END"]);
    expect(tr(FORMATS.OPENAI, FORMATS.CLAUDE, { ...base, stop: ["a", "b"] }).stop_sequences).toEqual(["a", "b"]);
  });
  it("OpenAI stop -> Gemini stopSequences, truncated to 5", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = tr(FORMATS.OPENAI, FORMATS.GEMINI, { ...base, stop: ["1", "2", "3", "4", "5", "6"] });
    expect(out.generationConfig.stopSequences).toEqual(["1", "2", "3", "4", "5"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("Claude stop_sequences -> OpenAI stop", () => {
    const out = tr(FORMATS.CLAUDE, FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }], stop_sequences: ["x", "y"], max_tokens: 10 });
    expect(out.stop).toEqual(["x", "y"]);
  });
  it("Gemini stopSequences -> OpenAI stop", () => {
    const out = tr(FORMATS.GEMINI, FORMATS.OPENAI, { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["z"] } });
    expect(out.stop).toBe("z");
  });
  it("Gemini -> Claude carries stop through the OpenAI pivot", () => {
    const out = tr(FORMATS.GEMINI, FORMATS.CLAUDE, { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["z", "w"] } });
    expect(out.stop_sequences).toEqual(["z", "w"]);
  });
});

describe("dropped params", () => {
  const base = { messages: [{ role: "user", content: "hi" }], tools: [TOOL] };
  it("Claude gets top_p and parallel_tool_calls=false", () => {
    const out = tr(FORMATS.OPENAI, FORMATS.CLAUDE, { ...base, top_p: 0.5, parallel_tool_calls: false });
    expect(out.top_p).toBe(0.5);
    expect(out.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });
  it("parallel_tool_calls=false keeps a forced tool choice", () => {
    const out = tr(FORMATS.OPENAI, FORMATS.CLAUDE, { ...base, parallel_tool_calls: false, tool_choice: "required" });
    expect(out.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });
  it("Claude disable_parallel_tool_use -> OpenAI parallel_tool_calls=false", () => {
    const out = tr(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [{ role: "user", content: "hi" }], max_tokens: 10,
      tools: [{ name: "t", input_schema: { type: "object" } }], tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    expect(out.parallel_tool_calls).toBe(false);
  });
  it("Gemini gets response_format json_schema -> responseSchema", () => {
    const out = tr(FORMATS.OPENAI, FORMATS.GEMINI, {
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object", properties: { a: { type: "string" } } } } },
    });
    expect(out.generationConfig.responseMimeType).toBe("application/json");
    expect(out.generationConfig.responseSchema).toBeTruthy();
  });
  it("Gemini response_format json_object -> responseMimeType", () => {
    const out = tr(FORMATS.OPENAI, FORMATS.GEMINI, { messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } });
    expect(out.generationConfig.responseMimeType).toBe("application/json");
  });
  it.each([
    ["auto", "AUTO", undefined],
    ["none", "NONE", undefined],
    ["required", "ANY", undefined],
    [{ type: "function", function: { name: "get_weather" } }, "ANY", ["get_weather"]],
  ])("Gemini tool_choice %j -> toolConfig", (choice, mode, names) => {
    const out = tr(FORMATS.OPENAI, FORMATS.GEMINI, { ...base, tool_choice: choice });
    expect(out.toolConfig.functionCallingConfig.mode).toBe(mode);
    expect(out.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(names);
  });
  it("Gemini toolConfig / responseSchema -> OpenAI tool_choice / response_format", () => {
    const out = tr(FORMATS.GEMINI, FORMATS.OPENAI, {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [{ functionDeclarations: [{ name: "f", parameters: { type: "OBJECT", properties: { a: { type: "STRING" } } } }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["f"] } },
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
    });
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "f" } });
    expect(out.tools[0].function.parameters.properties.a.type).toBe("string");
    expect(out.response_format.type).toBe("json_schema");
  });
  it("n>1 is rejected for Claude and Gemini targets, allowed for OpenAI", () => {
    const body = { messages: [{ role: "user", content: "hi" }], n: 2 };
    expect(() => tr(FORMATS.OPENAI, FORMATS.CLAUDE, body, "claude-x")).toThrow(RequestParamError);
    expect(() => tr(FORMATS.OPENAI, FORMATS.CLAUDE, body, "claude-x")).toThrow(/n>1 not supported/);
    expect(() => tr(FORMATS.OPENAI, FORMATS.GEMINI, body)).toThrow(RequestParamError);
    expect(() => tr(FORMATS.OPENAI, FORMATS.OPENAI, body)).not.toThrow();
  });
  it("raw Gemini candidateCount>1 / responseLogprobs is rejected for a Claude target", () => {
    const g = (generationConfig) => ({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig });
    expect(() => tr(FORMATS.GEMINI, FORMATS.CLAUDE, g({ candidateCount: 2 }), "claude-x")).toThrow(/n>1 not supported/);
    expect(() => tr(FORMATS.GEMINI, FORMATS.CLAUDE, g({ responseLogprobs: true, logprobs: 3 }), "claude-x")).toThrow(RequestParamError);
    expect(() => tr(FORMATS.GEMINI, FORMATS.CLAUDE, g({ candidateCount: 1 }), "claude-x")).not.toThrow();
  });
  it("same-format passthrough keeps candidateCount>1 / n>1 / logprobs (no translation, response intact)", () => {
    const g = { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { candidateCount: 2, responseLogprobs: true, logprobs: 3 } };
    expect(() => tr(FORMATS.GEMINI, FORMATS.GEMINI, g)).not.toThrow();
    const o = { messages: [{ role: "user", content: "hi" }], n: 2, logprobs: true, top_logprobs: 3 };
    expect(() => tr(FORMATS.OPENAI, FORMATS.OPENAI, o)).not.toThrow();
  });
  it("logprobs alone is ignored; logprobs + top_logprobs is rejected", () => {
    const body = { messages: [{ role: "user", content: "hi" }], logprobs: true };
    expect(() => tr(FORMATS.OPENAI, FORMATS.CLAUDE, body)).not.toThrow();
    expect(() => tr(FORMATS.OPENAI, FORMATS.CLAUDE, { ...body, top_logprobs: 3 })).toThrow(RequestParamError);
  });
});

describe("openai -> gemini response translator", () => {
  it("non-stream tool_calls become functionCall parts with ids", () => {
    const out = openaiCompletionToGemini({
      id: "r1", model: "gm", usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"c\":\"Paris\"}" } }] } }],
    }, "gm");
    expect(out.candidates[0].content.parts).toEqual([{ functionCall: { name: "get_weather", args: { c: "Paris" }, id: "call_1" } }]);
    expect(out.candidates[0].finishReason).toBe("STOP");
    expect(out.usageMetadata.totalTokenCount).toBe(3);
  });
  it("streams fragmented tool call as one functionCall at finish", () => {
    const state = initState(FORMATS.GEMINI);
    const feed = (c) => translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, c, state);
    expect(feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "get_weather", arguments: "{\"c\":" } }] } }] })).toEqual([]);
    expect(feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"Rome\"}" } }] } }] })).toEqual([]);
    const [fin] = feed({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    expect(fin.candidates[0].content.parts[0].functionCall).toEqual({ name: "get_weather", args: { c: "Rome" }, id: "call_9" });
    expect(fin.candidates[0].finishReason).toBe("STOP");
    expect(fin.usageMetadata.totalTokenCount).toBe(2);
  });
  it("usage-only trailer after finish carries no candidates", () => {
    const state = initState(FORMATS.GEMINI);
    const feed = (c) => translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, c, state);
    feed({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] });
    const [tail] = feed({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    expect(tail.candidates).toBeUndefined();
    expect(tail.usageMetadata.totalTokenCount).toBe(2);
  });
});

describe("/v1beta route", () => {
  const params = { params: Promise.resolve({ path: ["gemini-x:streamGenerateContent"] }) };
  const req = (body, action = "streamGenerateContent") => new Request(`https://router.test/v1beta/models/gemini-x:${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const geminiBody = {
    contents: [{ role: "user", parts: [{ text: "weather?" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] }],
    tools: [{ functionDeclarations: [{ name: "get_weather", description: "d", parameters: { type: "OBJECT", properties: {} } }] }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { stopSequences: ["STOP"], maxOutputTokens: 100 },
  };

  beforeEach(() => { vi.clearAllMocks(); });

  it("forwards tools, images and stop to handleChat as OpenAI", async () => {
    mocks.handleChat.mockResolvedValue(Response.json({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
    await POST(req(geminiBody, "generateContent"), { params: Promise.resolve({ path: ["gemini-x:generateContent"] }) });
    const sent = await mocks.handleChat.mock.calls[0][0].json();
    expect(sent.tools[0].function.name).toBe("get_weather");
    expect(sent.tool_choice).toBe("auto");
    expect(sent.stop).toBe("STOP");
    expect(sent.messages[0].content.some((p) => p.type === "image_url")).toBe(true);
  });

  it("non-stream tool call round trip", async () => {
    mocks.handleChat.mockResolvedValue(Response.json({
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }] } }],
    }));
    const res = await POST(req(geminiBody, "generateContent"), { params: Promise.resolve({ path: ["gemini-x:generateContent"] }) });
    const json = await res.json();
    expect(json.candidates[0].content.parts[0].functionCall.name).toBe("get_weather");
  });

  it("streams tool calls and survives SSE lines split across chunks", async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_weather", arguments: "{\"a\":1}" } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const enc = new TextEncoder();
    const bytes = enc.encode(lines);
    // Split at awkward byte offsets, mid-line.
    const cuts = [7, 40, 95, 150, bytes.length];
    const stream = new ReadableStream({
      start(c) { let prev = 0; for (const cut of cuts) { c.enqueue(bytes.slice(prev, cut)); prev = cut; } c.close(); },
    });
    mocks.handleChat.mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    const res = await POST(req(geminiBody), params);
    const text = await res.text();
    const frames = text.split("\r\n\r\n").filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, "")));
    expect(frames.map((f) => f.candidates[0].content.parts[0])).toEqual([
      { text: "Hel" },
      { functionCall: { name: "get_weather", args: { a: 1 }, id: "c1" } },
    ]);
    expect(frames[1].candidates[0].finishReason).toBe("STOP");
    expect(text).not.toContain("[DONE]");
  });

  it("re-emits mid-stream error frames in Gemini shape", async () => {
    const body = `data: ${JSON.stringify({ error: { message: "boom", type: "rate_limit_error" } })}\n\ndata: [DONE]\n\n`;
    mocks.handleChat.mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    const text = await (await POST(req(geminiBody), params)).text();
    expect(JSON.parse(text.replace(/^data: /, "").trim())).toEqual({ error: { code: 429, message: "boom", status: "RESOURCE_EXHAUSTED" } });
  });

  it("bad JSON -> Gemini-shaped 400", async () => {
    const res = await POST(new Request("https://router.test/v1beta/models/x:generateContent", { method: "POST", body: "{nope" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error.status).toBe("INVALID_ARGUMENT");
  });
});

describe("per-protocol error shapes", () => {
  it("resolves the dialect from path/format", () => {
    expect(resolveErrorFormat("/v1/messages")).toBe(FORMATS.CLAUDE);
    expect(resolveErrorFormat("/api/v1/messages")).toBe(FORMATS.CLAUDE);
    expect(resolveErrorFormat("/v1beta/models/x:generateContent")).toBe(FORMATS.GEMINI);
    expect(resolveErrorFormat("/v1/chat/completions")).toBe(FORMATS.OPENAI);
    expect(resolveErrorFormat(null, FORMATS.CLAUDE)).toBe(FORMATS.CLAUDE);
  });
  it.each([
    [400, "invalid_request_error", "INVALID_ARGUMENT"],
    [401, "authentication_error", "UNAUTHENTICATED"],
    [403, "permission_error", "PERMISSION_DENIED"],
    [404, "not_found_error", "NOT_FOUND"],
    [429, "rate_limit_error", "RESOURCE_EXHAUSTED"],
    [500, "api_error", "INTERNAL"],
    [503, "overloaded_error", "UNAVAILABLE"],
  ])("status %i", (status, claudeType, geminiStatus) => {
    expect(buildErrorBody(status, "m", FORMATS.CLAUDE)).toEqual({ type: "error", error: { type: claudeType, message: "m" } });
    expect(buildErrorBody(status, "m", FORMATS.GEMINI)).toEqual({ error: { code: status, message: "m", status: geminiStatus } });
    expect(buildErrorBody(status, "m").error.type).toBeTruthy();
  });
  it("unavailableResponse carries a type and the retry-after header", async () => {
    const res = unavailableResponse(429, "busy", new Date(Date.now() + 5000).toISOString(), "reset after 5s");
    expect((await res.json()).error.type).toBe("rate_limit_error");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
  it("reshapeErrorResponse converts OpenAI bodies and keeps status/headers", async () => {
    const src = errorResponse(429, "slow down", { "x-extra": "1" });
    const claude = await reshapeErrorResponse(src, FORMATS.CLAUDE);
    expect(claude.status).toBe(429);
    expect(claude.headers.get("x-extra")).toBe("1");
    expect(await claude.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    const gemini = await reshapeErrorResponse(errorResponse(401, "nope"), FORMATS.GEMINI);
    expect((await gemini.json()).error.status).toBe("UNAUTHENTICATED");
    const ok = new Response("x", { status: 200 });
    expect(await reshapeErrorResponse(ok, FORMATS.CLAUDE)).toBe(ok);
  });
  it("mid-stream errors follow the client format", () => {
    const dec = (b) => new TextDecoder().decode(b);
    const claude = dec(buildStreamErrorBytes(500, "x", FORMATS.CLAUDE));
    expect(claude).toContain("event: error");
    expect(claude).toContain('"type":"api_error"');
    expect(claude).not.toContain("server_error");
    expect(claude).not.toContain("[DONE]");
    const gemini = dec(buildStreamErrorBytes(503, "x", FORMATS.GEMINI));
    expect(gemini).toContain('"status":"UNAVAILABLE"');
    expect(gemini).not.toContain("[DONE]");
    const openai = dec(buildStreamErrorBytes(500, "x", FORMATS.OPENAI));
    expect(openai).toContain("server_error");
    expect(openai).toContain("[DONE]");
  });
  it("403 no longer reports insufficient_quota; key-access can override the code", async () => {
    expect(buildErrorBody(403, "m").error.code).toBe("permission_denied");
    const res = errorResponse(403, "denied", null, undefined, "model_not_allowed");
    expect((await res.json()).error).toMatchObject({ type: "permission_error", code: "model_not_allowed" });
  });
});

describe("Anthropic model list", () => {
  const models = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, created: 1700000000 }));
  it("uses the Anthropic shape and paginates", () => {
    const page = toAnthropicModelList(models, { limit: "2" });
    expect(page).toEqual({
      data: [
        { type: "model", id: "m0", display_name: "M0", created_at: "2023-11-14T22:13:20.000Z" },
        { type: "model", id: "m1", display_name: "M1", created_at: "2023-11-14T22:13:20.000Z" },
      ],
      has_more: true, first_id: "m0", last_id: "m1",
    });
    const next = toAnthropicModelList(models, { limit: 2, afterId: "m1" });
    expect(next.data.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(toAnthropicModelList(models, { afterId: "m3" }).has_more).toBe(false);
  });
});

describe("/v1/responses/compact", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns 400 (not 500) for an unparseable body", async () => {
    const { POST: compact } = await import("../../src/app/api/v1/responses/compact/route.js");
    const res = await compact(new Request("https://router.test/v1/responses/compact", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.type).toBe("invalid_request_error");
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });
});
