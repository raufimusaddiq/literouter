// OpencodeGoExecutor sanitization + all-model regression.
// Verifies that the bug we fixed — Codex-style multi-turn requests with
// previous_response_id and server-generated item IDs (rs_/fc_/resp_/msg_) —
// no longer reach OpenCode Go's /responses endpoint, while chat-completion
// requests for non-Luna models still pass through untouched.
import { describe, expect, it, beforeEach } from "vitest";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

const executor = new OpenCodeGoExecutor();

// Mirror of PROVIDER_MODELS["opencode-go"]
const ALL_MODELS = [
  "gpt-5.6-luna",
  "ox-alpha-free",
  "glm-5.3-flash", "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6",
  "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
  "mimo-v2.5", "mimo-v2.5-pro",
  "minimax-m3", "minimax-m2.7", "minimax-m2.5",
  "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
  "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
];

describe("OpencodeGoExecutor — sanitization (the actual bug)", () => {
  it("strips previous_response_id (the root cause of 9router/Codex error)", () => {
    const body = {
      model: "gpt-5.6-luna",
      previous_response_id: "resp_anything",
      input: [{ type: "message", role: "user", content: "ping" }],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.previous_response_id).toBeUndefined();
  });

  it("strips server-generated item IDs (rs_/fc_/resp_/msg_) from input[]", () => {
    const body = {
      model: "gpt-5.6-luna",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { id: "rs_resp_chatcmpl-1787986603139_0", type: "message", role: "assistant", content: [{ type: "output_text", text: "previous turn" }] },
        { type: "function_call", id: "fc_abc123", call_id: "call_1", name: "f", arguments: "{}" },
        { type: "item_reference", id: "resp_ref_1" }, // bare reference should be dropped entirely
        { id: "msg_user2", type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
      ],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.input).toHaveLength(4);
    expect(transformed.input.map((i) => i.id)).toEqual([undefined, undefined, undefined, undefined]);
    expect(transformed.input.some((i) => i.type === "item_reference")).toBe(false);
  });

  it("forces store=false so upstream never tries to resolve prior items", () => {
    const body = {
      model: "gpt-5.6-luna",
      store: true,
      input: [{ type: "message", role: "user", content: "hi" }],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.store).toBe(false);
  });

  it("forces stream=true (OpenCode Go Responses requires it)", () => {
    const body = {
      model: "gpt-5.6-luna",
      stream: false,
      input: [{ type: "message", role: "user", content: "hi" }],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.stream).toBe(true);
  });

  it("strips sampling controls that OpenCode Go's Responses rejects", () => {
    const body = {
      model: "gpt-5.6-luna",
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 256,
      max_output_tokens: 512,
      max_completion_tokens: 1024,
      metadata: { foo: "bar" },
      stream_options: { include_usage: true },
      input: [{ type: "message", role: "user", content: "hi" }],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.temperature).toBeUndefined();
    expect(transformed.top_p).toBeUndefined();
    expect(transformed.max_tokens).toBeUndefined();
    expect(transformed.max_output_tokens).toBeUndefined();
    expect(transformed.max_completion_tokens).toBeUndefined();
    expect(transformed.metadata).toBeUndefined();
    expect(transformed.stream_options).toBeUndefined();
  });

  it("converts role=system to role=developer so prompts hit the cacheable prefix", () => {
    const body = {
      model: "gpt-5.6-luna",
      input: [{ role: "system", type: "message", content: [{ type: "input_text", text: "be terse" }] }],
    };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.input[0].role).toBe("developer");
  });

  it("does NOT inject Codex-specific identity headers (regression guard)", () => {
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["session_id"]).toBeUndefined();
    expect(headers["originator"]).toBeUndefined();
    expect(headers["ChatGPT-Account-ID"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("sends a stable x-opencode-session for each conversation", () => {
    const credentials = { apiKey: "sk-test", connectionId: "ocg-account", rawHeaders: { "x-opencode-session": "conversation-123" } };
    const body = { model: "gpt-5.6-luna", input: [{ type: "message", role: "user", content: "hi" }] };
    executor.transformRequest("gpt-5.6-luna", body, true, credentials);
    expect(executor.buildHeaders(credentials, true)["x-opencode-session"]).toBe("conversation-123");
  });

  it("does NOT inject Codex default instructions (overrides OpenCode Go system prompt)", () => {
    const body = { model: "gpt-5.6-luna", input: [{ type: "message", role: "user", content: "hi" }] };
    const transformed = executor.transformRequest("gpt-5.6-luna", body, true, null);
    expect(transformed.instructions).toBeUndefined();
  });

  it("uses x-api-key for the Claude transport", () => {
    const headers = executor.buildHeaders({ apiKey: "sk-test", runtimeTransport: {
      auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
    } }, false);
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("OpencodeGoExecutor — every model accepted (no breakage)", () => {
  it.each(ALL_MODELS)("model %s — transforms without throwing", (model) => {
    const body = {
      model,
      stream: false,
      temperature: 0.5,
      previous_response_id: "resp_x",
      max_output_tokens: 4096,
      input: [
        { role: "system", content: "sys" },
        { id: "msg_x", role: "user", content: "hi" },
      ],
      tools: [{ type: "function", function: { name: "ping", description: "", parameters: { type: "object", properties: {} } } }],
    };
    const transformed = executor.transformRequest(model, body, true, null);
    expect(transformed.previous_response_id).toBeUndefined();
    expect(Array.isArray(transformed.input)).toBe(true);
    if (model === "gpt-5.6-luna" || model.startsWith("muse-spark-")) {
      expect(transformed.store).toBe(false);
      expect(transformed.stream).toBe(true);
    } else {
      expect(transformed.store).toBeUndefined();
      expect(transformed.stream).toBe(false);
    }
    expect(transformed.temperature).toBe(model === "gpt-5.6-luna" ? undefined : 0.5);
  });
});

describe("OpencodeGoExecutor — chat-completion regression (non-Luna models)", () => {
  // Chat-only models (DeepSeek, GLM, Kimi, MiMo, MiniMax, Qwen) use
  // /v1/chat/completions. Our executor only fires on /responses; chat bodies
  // arrive as {messages:[...]} which we must leave alone when present.
  // We test the same sanitization only runs when input[] exists, otherwise
  // the executor simply forwards {messages} to the chat transport.
  it("preserves messages[] for chat-completion models", () => {
    const body = {
      model: "glm-5.2",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    };
    const transformed = executor.transformRequest("glm-5.2", body, true, null);
    expect(transformed.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(transformed.input).toBeUndefined();
  });

  it("strips previous_response_id even when sent with messages (defense in depth)", () => {
    const body = {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      previous_response_id: "resp_should_be_gone",
    };
    const transformed = executor.transformRequest("deepseek-v4-flash", body, true, null);
    expect(transformed.previous_response_id).toBeUndefined();
  });
});
