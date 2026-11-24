import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import {
  AntigravityExecutor,
  ANTIGRAVITY_PROMPT_REJECTED_MESSAGE,
  isAntigravityPromptRejection,
  moveSystemInstructionToContents,
} from "../../open-sse/executors/antigravity.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { checkFallbackError, shouldRotateAccount } from "../../open-sse/services/accountFallback.js";

const BARE = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } });
const WITH_RETRY_INFO = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED",
  details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s" }] } });
const REAL_QUOTA = JSON.stringify({ error: { code: 429, message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h56m48s.", status: "RESOURCE_EXHAUSTED",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED", metadata: { quotaResetTimeStamp: new Date(Date.now() + 3600_000).toISOString() } }] } });

const response = (status, body, headers = {}) => new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

const plainResponse = (status, body) => {
  let drained = false;
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Map([["content-type", "application/json"]]),
    text: async () => { if (drained) return ""; drained = true; return body; },
  };
  res.json = async () => JSON.parse(await res.text());
  return res;
};

const SYSTEM = "Follow the house rules.";
const credentials = { accessToken: "t", projectId: "p", connectionId: "c" };
const sentBody = (call) => JSON.parse(fetchMock.mock.calls[call][1].body);
const ok = (extra = {}) => response(200, JSON.stringify({ response: {
  candidates: [{ content: { role: "model", parts: [{ text: "pong" }] }, finishReason: "STOP", ...extra }],
} }));

const ag = new AntigravityExecutor();
const run = ({ model = "gemini-4-hydrogen", system = true, generationConfig = {}, stream = false } = {}) => ag.execute({
  model,
  body: {
    model: model === "gemini-4-hydrogen" ? "gemini-4-hydrogen-high" : model,
    request: {
      ...(system && { systemInstruction: { role: "user", parts: [{ text: SYSTEM }] } }),
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig,
    },
  },
  stream,
  credentials,
});
const sentSystemTexts = (call) => (sentBody(call).request.systemInstruction?.parts || []).map((p) => p.text);

beforeEach(() => fetchMock.mockReset());

describe("isAntigravityPromptRejection", () => {
  it.each([
    ["the bare RESOURCE_EXHAUSTED body", 429, BARE, true],
    ["one with RetryInfo details", 429, WITH_RETRY_INFO, false],
    ["a real quota error", 429, REAL_QUOTA, false],
    ["a non-429 status", 503, BARE, false],
    ["an empty body", 429, "", false],
    ["a non-JSON body", 429, "Resource has been exhausted (e.g. check quota).", false],
  ])("classifies %s", (_label, status, body, expected) => {
    expect(isAntigravityPromptRejection(status, body)).toBe(expected);
  });
});

describe("Antigravity retry and lock decisions", () => {
  it.each([
    ["the bare rejection is not retried in place", response(429, BARE), false],
    ["an empty 429 keeps its exponential backoff", response(429, ""), 2000],
    ["a RetryInfo 429 keeps its backoff", response(429, WITH_RETRY_INFO), 2000],
  ])("%s", async (_label, upstream, delay) => {
    expect(await ag.computeRetryDelay(upstream, 1)).toBe(delay);
  });

  it("reports the bare rejection as a request-scoped 400 that never rotates or locks the account", async () => {
    const parsed = await parseUpstreamError(response(429, BARE), ag);
    expect(parsed).toMatchObject({ statusCode: 400, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE });
    const decision = checkFallbackError(parsed.statusCode, parsed.message, 0, "antigravity");
    expect(decision).toMatchObject({ shouldFallback: false, cooldownMs: 0, scope: "request" });
    expect(shouldRotateAccount(decision)).toBe(false);
  });

  it.each([
    ["a real quota error", REAL_QUOTA],
    ["a RetryInfo 429", WITH_RETRY_INFO],
  ])("keeps %s a plain 429 with no executor reset time", async (_label, body) => {
    const parsed = await parseUpstreamError(response(429, body), ag);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it.each([
    ["Response", response],
    ["clone-less response", plainResponse],
  ])("makes one upstream call for a rejected request with no system text (%s)", async (_label, make) => {
    fetchMock.mockImplementation(async () => make(429, BARE));
    const { response: upstream } = await run({ system: false, stream: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await parseUpstreamError(upstream, ag)).toMatchObject({ statusCode: 400, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE });
  });
});

describe("retry with the system prompt in the first user turn", () => {
  it.each([
    ["Response", response],
    ["clone-less response", plainResponse],
  ])("moves the system text to the front of the first user turn and succeeds (%s)", async (_label, make) => {
    fetchMock.mockResolvedValueOnce(make(429, BARE)).mockResolvedValueOnce(ok());
    const { response: upstream } = await run();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentSystemTexts(0)).toContain(SYSTEM);
    expect(sentSystemTexts(1)).not.toContain(SYSTEM);
    expect(sentBody(1).request.contents[0]).toEqual({ role: "user", parts: [{ text: SYSTEM }, { text: "hi" }] });
    expect(upstream.status).toBe(200);
  });

  it.each([
    ["Response", response],
    ["clone-less response", plainResponse],
  ])("reports the request-scoped 400 when the moved prompt is refused too (%s)", async (_label, make) => {
    fetchMock.mockImplementation(async () => make(429, BARE));
    const { response: upstream } = await run();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await parseUpstreamError(upstream, ag)).toMatchObject({ statusCode: 400, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE });
  });

  it("does not move the prompt for a real quota error", async () => {
    fetchMock.mockResolvedValueOnce(response(429, REAL_QUOTA, { "retry-after": "3600" }));
    const { response: upstream } = await run();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstream.status).toBe(429);
  });

  it("does not move the prompt for image generation", async () => {
    fetchMock.mockImplementation(async () => response(429, BARE));
    const { response: upstream } = await run({ model: "gemini-3.1-flash-image" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await parseUpstreamError(upstream, ag)).statusCode).toBe(400);
  });

  it("re-sends the moved prompt on long-decode continuation hops", async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, BARE))
      .mockResolvedValueOnce(ok({ finishReason: "CONTINUATION", continuationToken: "tok1" }))
      .mockResolvedValueOnce(ok());
    const { response: upstream } = await run({ generationConfig: { maxOutputTokens: 262144 } });
    await upstream.text();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentBody(2).request.continuationToken).toBe("tok1");
    expect(sentSystemTexts(2)).not.toContain(SYSTEM);
    expect(sentBody(2).request.contents[0].parts[0]).toEqual({ text: SYSTEM });
  });
});

describe("moveSystemInstructionToContents", () => {
  it.each([
    ["no system instruction", undefined],
    ["only blank system text", { role: "user", parts: [{ text: "  " }] }],
  ])("returns null with %s", (_label, systemInstruction) => {
    const contents = [{ role: "user", parts: [{ text: "hi" }] }];
    expect(moveSystemInstructionToContents({ request: { contents, systemInstruction } })).toBeNull();
  });

  it("does not mutate the original envelope", () => {
    const body = { request: { systemInstruction: { role: "user", parts: [{ text: "rules" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    const moved = moveSystemInstructionToContents(body);
    expect(body.request.systemInstruction.parts).toEqual([{ text: "rules" }]);
    expect(body.request.contents).toHaveLength(1);
    expect(moved.request.contents[0]).toEqual({ role: "user", parts: [{ text: "rules" }] });
  });
});
