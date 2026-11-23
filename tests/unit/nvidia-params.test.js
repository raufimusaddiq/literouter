import { describe, it, expect } from "bun:test";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import nvidiaConfig from "../../open-sse/providers/registry/nvidia.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("nvidia NIM hardening", () => {
  it("declares dropClientMetadata and the transport timeout", () => {
    expect(nvidiaConfig.transport.quirks?.dropClientMetadata).toBe(true);
    expect(nvidiaConfig.transport.timeoutMs).toBe(90000);
  });

  it("lists the current NIM catalogue", () => {
    const ids = nvidiaConfig.models.map((m) => m.id);
    expect(ids).toContain("meta/llama-3.3-70b-instruct");
    expect(ids).toContain("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(ids).toContain("nvidia/nemotron-3.5-bolt-e4b");
    expect(ids).toContain("poolside/laguna-xs-2.1");
  });

  it("strips params NVIDIA rejects and keeps the reasoning rename", () => {
    const payload = {
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi", reasoning: "thinking text" },
      ],
      client_metadata: { source: "claude-code" },
      prompt_cache_key: "cache-123",
      service_tier: "default",
      anthropic_beta: ["tools-2024"],
      thinking_budget: 1024,
      user_id: "user-456",
      custom_field: "test",
      temperature: 0.7,
    };

    stripUnsupportedParams("nvidia", "meta/llama-3.3-70b-instruct", payload);

    expect(payload.client_metadata).toBeUndefined();
    expect(payload.prompt_cache_key).toBeUndefined();
    expect(payload.service_tier).toBeUndefined();
    expect(payload.anthropic_beta).toBeUndefined();
    expect(payload.thinking_budget).toBeUndefined();
    expect(payload.user_id).toBeUndefined();
    expect(payload.custom_field).toBeUndefined();
    expect(payload.temperature).toBe(0.7);

    expect(payload.messages[1].reasoning).toBeUndefined();
    expect(payload.messages[1].reasoning_content).toBe("thinking text");
  });

  it("strips the same params through DefaultExecutor and drops stream_options on non-streaming", () => {
    const executor = new DefaultExecutor("nvidia");
    const body = {
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", reasoning: "secret thought" },
      ],
      client_metadata: { source: "claude-code" },
      stream_options: { include_usage: true },
      prompt_cache_key: "cache-key-1",
      service_tier: "auto",
    };

    const transformed = executor.transformRequest("meta/llama-3.3-70b-instruct", body, false, {});

    expect("client_metadata" in transformed).toBe(false);
    expect("stream_options" in transformed).toBe(false);
    expect("prompt_cache_key" in transformed).toBe(false);
    expect("service_tier" in transformed).toBe(false);
    expect("reasoning" in transformed.messages[1]).toBe(false);
    expect(transformed.messages[1].reasoning_content).toBe("secret thought");
  });

  it("classifies the degraded cluster error as a 15m cooldown", () => {
    const result = checkFallbackError(400, "DEGRADED function cannot be invoked", 0, "nvidia");
    expect(result).toMatchObject({ shouldFallback: true, cooldownMs: 15 * 60 * 1000 });
  });

  it("does not apply the NIM rule to other providers", () => {
    const result = checkFallbackError(400, "DEGRADED function cannot be invoked", 0, "groq");
    expect(result.shouldFallback).toBe(false);
  });

  it("distinguishes tools support in the NIM capability profiles", () => {
    expect(getCapabilitiesForModel("nvidia", "meta/llama-3.3-70b-instruct").tools).toBe(true);
    expect(getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3").tools).toBe(false);
  });
});
