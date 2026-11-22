import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { openAICompletionToClaudeMessage } from "../../open-sse/translator/response/nonstream-to-claude.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const INTL = "sensenova-intl";
const INTL_HOST = "token.sensenova.ai";

const host = (url) => new URL(url).host;

async function drain(stream) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function sseStream(events) {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

const dataEvents = (text) => text
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
  .map((l) => JSON.parse(l.slice(6)));

describe("SenseNova intl provider", () => {
  it("is an OpenAI-compatible apikey provider with a unique id", () => {
    const entry = REGISTRY.find((e) => e.id === INTL);
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS[INTL].format).toBe("openai");
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("routes chat and validation to token.sensenova.ai", () => {
    expect(PROVIDERS[INTL].baseUrl).toBe(`https://${INTL_HOST}/v1/chat/completions`);
    expect(PROVIDERS[INTL].validateUrl).toBe(`https://${INTL_HOST}/v1/models`);
  });

  it("builds the chat URL from the registry host, ignoring providerSpecificData.baseUrl", () => {
    const creds = { apiKey: "k", providerSpecificData: { baseUrl: "https://evil.example/v1" } };
    expect(getExecutor(INTL)).toBeInstanceOf(DefaultExecutor);
    expect(host(getExecutor(INTL).buildUrl("sensenova-6.8-flash", true, 0, creds))).toBe(INTL_HOST);
  });

  it("lists only the chat catalog — LiteRouter has no image handler", () => {
    const models = PROVIDER_MODELS[INTL];
    expect(models.map((m) => m.id)).toEqual([
      "sensenova-6.8-flash",
      "sensenova-6.8-flash-lite",
      "sensenova-6.7-flash-lite",
    ]);
    expect(models.some((m) => m.kind === "image" || m.kind === "tts" || m.kind === "stt")).toBe(false);
    expect(PROVIDERS[INTL].imageConfig).toBeUndefined();
  });

  it("uses the intl endpoint limits", () => {
    for (const model of ["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-6.7-flash-lite"]) {
      expect(getCapabilitiesForModel(INTL, model), model).toMatchObject({
        vision: true, reasoning: true, tools: true, thinkingFormat: "openai",
        contextWindow: 262144, maxOutput: 65536,
      });
    }
  });
});

describe("SenseNova `reasoning` field", () => {
  const reasoningDelta = { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", reasoning: "think" } }] };
  const answerDelta = { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] };

  it("passthrough stream lifts delta.reasoning into reasoning_content", async () => {
    const out = dataEvents(await drain(sseStream([reasoningDelta, answerDelta]).pipeThrough(
      createPassthroughStreamWithLogger(INTL, null, "sensenova-6.8-flash", null, null, null, null),
    )));
    expect(out[0].choices[0].delta.reasoning_content).toBe("think");
    expect(out[0].choices[0].delta.reasoning).toBe("think");
    expect(out.at(-1).choices[0].delta.content).toBe("hi");
  });

  it("non-streaming OpenAI→Claude keeps message.reasoning as a thinking block", () => {
    const msg = openAICompletionToClaudeMessage({
      id: "c1",
      model: "sensenova-6.8-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "hi", reasoning: "think" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(msg.content[0]).toEqual({ type: "thinking", thinking: "think" });
    expect(msg.content[1]).toEqual({ type: "text", text: "hi" });
  });
});
