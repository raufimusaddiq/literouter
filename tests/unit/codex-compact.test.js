import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, saveDetail } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  saveDetail: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {},
    logProviderResponse() {}, logConvertedResponse() {}, logError() {},
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest() {},
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: saveDetail,
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async (importOriginal) => ({
  ...await importOriginal(),
  saveUsageStats: vi.fn(),
}));

const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const model = "gpt-6.1-sol";
const credentials = { accessToken: "test-token", providerSpecificData: {} };
const input = [{ type: "compaction", encrypted_content: "old-encrypted-state" }];
const compactResponse = {
  id: "cmp_test",
  object: "response.compaction",
  output: [{ type: "compaction", encrypted_content: "new-encrypted-state" }],
  usage: { input_tokens: 120, output_tokens: 15, total_tokens: 135 },
};

function runCompact(provider = "codex") {
  const body = { model, input, instructions: "Preserve context", _compact: true };
  return handleChatCore({
    body, modelInfo: { provider, model }, credentials,
    connectionId: "compact-test",
    sourceFormatOverride: "openai-responses",
    clientRawRequest: { endpoint: "/v1/responses/compact", body, headers: {} },
  });
}

describe("Codex native compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async () => Response.json(compactResponse));
  });

  it("returns compact JSON without forcing SSE or modifying encrypted items", async () => {
    const result = await runCompact();
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect(await result.response.json()).toEqual(compactResponse);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/responses\/compact$/);
    expect(options.headers.Accept).not.toBe("text/event-stream");
    expect(JSON.parse(options.body)).toEqual({ model, input, instructions: "Preserve context" });
    expect(saveDetail.mock.calls.at(-1)[0].status).toBe("success");
  });

  it("selects URLs per request across compact, chat, then compact on one executor", async () => {
    const executor = new CodexExecutor();
    for (const compact of [true, false, true]) {
      fetchMock.mockImplementation(async () => compact
        ? Response.json(compactResponse)
        : new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }));
      const result = await executor.execute({
        model, credentials, stream: !compact,
        body: { model, input, ...(compact ? { _compact: true } : {}) },
      });
      expect(result.url.endsWith("/compact")).toBe(compact);
      expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body).stream).toBe(compact ? undefined : true);
      await result.response.text();
    }
  });

  it.each([
    [{ object: "response", output: [] }, "application/json"],
    [compactResponse, "text/event-stream"],
  ])("rejects malformed compact responses instead of reporting success", async (payload, contentType) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(payload), {
      headers: { "content-type": contentType },
    }));
    const result = await runCompact();
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(saveDetail.mock.calls.some(([detail]) => detail.status === "success")).toBe(false);
  });

  it("rejects non-Codex compaction without calling another provider's chat endpoint", async () => {
    const result = await runCompact("typesafe");
    expect(result.response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
