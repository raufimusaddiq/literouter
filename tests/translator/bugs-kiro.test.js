import { describe, it, expect } from "bun:test";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2K = (body) => translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "m", body, true, null, "kiro");
const R2K = (model, body) => translateRequest(
  FORMATS.OPENAI_RESPONSES,
  FORMATS.KIRO,
  model,
  body,
  true,
  null,
  "kiro"
);

describe("OpenAI → Kiro", () => {
  it.each([
    ["high", "gpt-5.6-sol"],
    ["medium", "gpt-5.6-terra"],
    ["low", "gpt-5.6-luna"],
  ])("preserves Responses reasoning.effort %p through the full Kiro route", (effort, model) => {
    const out = R2K(model, {
      input: "Use the requested effort",
      reasoning: { effort },
    });

    expect(out.additionalModelRequestFields).toEqual({
      reasoning: { effort },
    });
    expect(out.systemPrompt || "").not.toContain("<thinking_mode>");
    expect(out.systemPrompt || "").not.toContain("<max_thinking_length>");
  });

  it("malformed tool arguments do not throw the whole request", () => {
    expect(() =>
      O2K({
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "", tool_calls: [
            { id: "c1", type: "function", function: { name: "f", arguments: "{not json" } },
          ] },
          { role: "tool", tool_call_id: "c1", content: "r" },
        ],
      })
    ).not.toThrow();
  });

  it("respects client max_tokens", () => {
    const out = O2K({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });
    expect(out.inferenceConfig?.maxTokens, "client max_tokens ignored").toBe(100);
  });

  it("caps max_tokens at the Kiro ceiling", () => {
    const out = O2K({ max_tokens: 999999, messages: [{ role: "user", content: "hi" }] });
    expect(out.inferenceConfig?.maxTokens).toBe(32000);
  });

  it("data uri image becomes a Kiro image", () => {
    const out = O2K({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    const images = out.conversationState?.currentMessage?.userInputMessage?.images || [];
    expect(images).toEqual([{ format: "png", source: { bytes: "AAAA" } }]);
  });
});
