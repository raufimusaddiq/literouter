import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const T = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", body, true, null, "anthropic-compatible-x");

describe("OpenAI → Claude context mapping", () => {
  it.fails("does not inject Claude Code system prompt for compatible providers", () => {
    const out = T({ messages: [{ role: "user", content: "hi" }] });
    expect(JSON.stringify(out.system), "Claude Code prompt injected").not.toContain("Claude Code");
  });

  it("assistant reasoning_content becomes a thinking block", () => {
    const out = T({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a", reasoning_content: "my hidden reasoning" },
        { role: "user", content: "next" },
      ],
    });
    expect(JSON.stringify(out), "reasoning_content lost").toContain("my hidden reasoning");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual(expect.objectContaining({
      type: "thinking",
      thinking: "my hidden reasoning",
    }));
  });

  it("tool_choice=none is not turned into auto", () => {
    const out = T({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
      tool_choice: "none",
    });
    expect(out.tool_choice?.type, "none became auto → model may call tools").not.toBe("auto");
  });

  it.fails("input_audio content is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "transcribe" },
        { type: "input_audio", input_audio: { data: "AUDIO_B64", format: "wav" } },
      ] }],
    });
    expect(JSON.stringify(out), "audio dropped").toContain("AUDIO_B64");
  });

  it("remote http image_url is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://x.com/pic.png" } },
      ] }],
    });
    expect(JSON.stringify(out), "remote image dropped").toContain("pic.png");
  });

  it("user message with only an image is not dropped as empty", () => {
    const out = T({
      messages: [
        { role: "system", content: "Describe the image." },
        { role: "user", content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ] },
      ],
    });
    expect(out.messages.length, "image-only user message was dropped").toBeGreaterThan(0);
    expect(out.messages[0].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image" })])
    );
  });

  describe("max_tokens vs thinking.budget_tokens reconciliation", () => {
    it("max effort budget on a 64k model → budget < max_tokens ≤ 64000", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 128000 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
      expect(out.thinking.budget_tokens).toBeGreaterThan(0);
    });

    it("xhigh budget with a low client max_tokens → raise max_tokens, preserve budget", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 32768 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.thinking.budget_tokens).toBe(32768);
      expect(out.max_tokens).toBe(33792);
    });

    it("high budget under max_tokens → both unchanged", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 24576 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking.budget_tokens).toBe(24576);
    });

    it("adaptive thinking (no budget_tokens) is left untouched", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking).toEqual({ type: "adaptive" });
    });

    it("max effort budget on a 128k model → max_tokens up to 128000, budget preserved just under", () => {
      const out = prepareClaudeRequest({
        model: "claude-fable-5",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 128000 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(128000);
      expect(out.thinking.budget_tokens).toBe(126976);
      expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
    });

    it("over-large client max_tokens on a 64k model is still clamped to 64000", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 120000,
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
    });

    it("large client max_tokens on a 128k model is allowed up to maxOutput", () => {
      const out = prepareClaudeRequest({
        model: "claude-fable-5",
        max_tokens: 100000,
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(100000);
    });
  });

  it("DeepSeek Claude transport adds a thinking placeholder before tool_use in thinking mode", () => {
    const out = prepareClaudeRequest({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
    }, "deepseek");

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "." });
    expect(assistant.content[1]).toEqual(expect.objectContaining({ type: "tool_use", id: "toolu_1" }));
    expect(assistant.content[0].signature).toBeUndefined();
  });
});
