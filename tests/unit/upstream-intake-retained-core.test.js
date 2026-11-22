import { afterEach, expect, it, vi } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

afterEach(() => vi.unstubAllGlobals());

it("keeps Luna native Responses capabilities alongside the GLM fix", () => {
  expect(getCapabilitiesForModel("opencode-go", "gpt-5.6-luna").thinkingFormat).toBe("openai-responses");
  expect(getCapabilitiesForModel("opencode-go", "glm-5.3-flash").thinkingFormat).toBe("openai");
});

it("omits leaked Antigravity agent requestType and rewrites Hermes identity variants", () => {
  for (const identity of ["You are Hermes.", "You are Hermes Agent, an intelligent AI assistant created by Nous Research."]) {
    const body = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      requestType: "agent",
      request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], systemInstruction: { parts: [{ text: identity }] } },
    }, true, { projectId: "offline-project" });
    expect(body).not.toHaveProperty("requestType");
    expect(body.request.systemInstruction.parts[0].text).toBe("You are an AI assistant.");
  }
});

it("restores tool names inside translated and terminal Responses envelopes", () => {
  const event = { event: "response.completed", data: { type: "response.completed", response: { output: [{ type: "function_call", name: "bash" }] } } };
  const restored = restoreToolNames(event, new Map([["bash", "Bash"]]));
  expect(restored.data.response.output[0].name).toBe("Bash");
  expect(event.data.response.output[0].name).toBe("bash");
});

it.each(["openai", "openai-responses"])("restores tool names on same-format %s streaming", async (format) => {
  const payload = format === "openai"
    ? { id: "chatcmpl-test", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }] } }] }
    : { type: "response.completed", response: { id: "resp_1", output: [{ type: "function_call", name: "bash" }], status: "completed" } };
  const prefix = format === "openai-responses" ? "event: response.completed\n" : "";
  const providerResponse = new Response(`${prefix}data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  const result = await handleStreamingResponse({
    providerResponse, provider: "opencode", model: "offline-model", sourceFormat: format, targetFormat: format,
    body: {}, stream: true, requestStartTime: Date.now(), toolNameMap: new Map([["bash", "Bash"]]),
    streamController: createStreamController(),
  });
  expect(await result.response.text()).toContain('"name":"Bash"');
});

it("keeps authorization from Headers on the retained relay transport", async () => {
  const fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
  await proxyAwareFetch("https://upstream.test/v1/messages", { headers: new Headers({ Authorization: "Bearer offline" }) }, { vercelRelayUrl: "https://relay.test" });
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer offline");
});
