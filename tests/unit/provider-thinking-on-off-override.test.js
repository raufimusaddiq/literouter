// providerThinking mode "on"/"off" must never leak into reasoning_effort.
// Before the fix, a body that already carried `thinking` fell through to the
// reasoning_effort branch and shipped the invalid value "on"/"off" upstream.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, refreshMock, errorResultMock, parseUpstreamErrorMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  refreshMock: vi.fn(),
  errorResultMock: vi.fn((status, message) => ({ success: false, status, error: message })),
  parseUpstreamErrorMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: refreshMock,
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn(async (fn) => fn()) }));

// Pass the body through untouched so we assert on the injected fields alone;
// the real translator legitimately rewrites thinking into the target wire format.
vi.mock("../../open-sse/translator/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  translateRequest: vi.fn((_s, _t, _m, body) => body),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", async (importOriginal) => ({
  ...(await importOriginal()),
  normalizeClaudePassthrough: vi.fn(),
  anchorClaudeCache: vi.fn(),
  prepareClaudeRequest: vi.fn((body) => body),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: vi.fn() }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: vi.fn() }));
vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));
vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
}));
vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: errorResultMock,
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: parseUpstreamErrorMock,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

// A non-user last turn so normalizeThinkingConfig keeps the client's `thinking`.
function options(providerThinking, thinking) {
  const body = {
    model: "gpt-4.1",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    ...(thinking ? { thinking } : {}),
  };
  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: "test-connection",
    providerThinking,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const calledBody = () => executeMock.mock.calls[0][0].body;

describe("providerThinking on/off never becomes reasoning_effort", () => {
  beforeEach(() => {
    executeMock.mockReset();
    // Reject so the handler stops before any response handling; we only read the request body.
    executeMock.mockRejectedValue(new Error("boom"));
  });

  it.each(["on", "off"])("mode %s with client thinking set keeps thinking and omits reasoning_effort", async (mode) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    await handleChatCore(options({ mode }, { type: "enabled", budget_tokens: 2048 }));

    const sent = calledBody();
    expect(sent.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(sent.reasoning_effort).toBeUndefined();
  });

  it.each(["on", "off"])("mode %s without client thinking injects the extended thinking type", async (mode) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    await handleChatCore(options({ mode }));

    const sent = calledBody();
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.thinking).toEqual(mode === "on" ? { type: "enabled", budget_tokens: 10000 } : { type: "disabled" });
  });

  it("effort modes still map to reasoning_effort", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    await handleChatCore(options({ mode: "high" }));

    expect(calledBody().reasoning_effort).toBe("high");
  });
});

// After a token refresh the retry is authoritative: its headers/body replace the
// stale 401, and the reported failure comes from the retry, not the auth error.
describe("post-refresh retry supersedes the stale 401", () => {
  const stubResponse = (status) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "" },
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  });

  beforeEach(() => {
    executeMock.mockReset();
    refreshMock.mockReset();
    errorResultMock.mockClear();
    parseUpstreamErrorMock.mockReset();
  });

  it("reports the retry's status and cancels the discarded 401", async () => {
    const stale = stubResponse(401);
    const retry = stubResponse(500);
    refreshMock.mockResolvedValue({ accessToken: "fresh" });
    executeMock
      .mockResolvedValueOnce({ response: stale, url: "https://a", headers: {}, transformedBody: {} })
      .mockResolvedValueOnce({ response: retry, url: "https://b", headers: { "x-retry": "1" }, transformedBody: { retried: true } });
    parseUpstreamErrorMock.mockResolvedValue({ statusCode: 500, message: "retry failed", resetsAtMs: null });

    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    await handleChatCore(options({ mode: "auto" }));

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(stale.body.cancel).toHaveBeenCalledTimes(1);
    expect(parseUpstreamErrorMock).toHaveBeenCalledWith(retry, expect.anything());
    expect(errorResultMock).toHaveBeenCalledWith(500, expect.anything(), null, expect.anything());
  });
});
