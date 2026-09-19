import { describe, expect, it } from "vitest";

// PRD 10: RTK, Caveman, and Ponytail must each work independently.
describe("token savers", () => {
  const savers = [
    ["Caveman", "open-sse/rtk/caveman.js", "injectCaveman"],
    ["Ponytail", "open-sse/rtk/ponytail.js", "injectPonytail"],
  ];

  // PRD 23 / docs/literouter-baseline/transform-field-map.md: assert the exact
  // field each transform writes, per wire shape, not merely "body changed".
  describe.each(savers)("%s", (_name, mod, fn) => {
    const load = async () => (await import(mod))[fn];

    it("injects at every level", async () => {
      const inject = await load();
      for (const level of ["lite", "full", "ultra"]) {
        const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
        inject(body, "openai", level);
        const injected = body.messages.find(m => m.role === "system");
        expect(injected?.content).toBeTruthy();
      }
    });

    it("appends to the existing chat system message", async () => {
      const inject = await load();
      const body = { model: "m", messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] };
      inject(body, "openai", "full");
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content.startsWith("base")).toBe(true);
      expect(body.messages[0].content.length).toBeGreaterThan(4);
    });

    it("appends to a Responses instructions string", async () => {
      const inject = await load();
      const body = { model: "m", instructions: "base", input: "hello" };
      inject(body, "openai", "full");
      expect(body.instructions.startsWith("base")).toBe(true);
      expect(body.instructions.length).toBeGreaterThan(4);
    });

    it("leaves a Responses string input untouched", async () => {
      const inject = await load();
      const body = { model: "m", input: "hello" };
      inject(body, "openai", "full");
      expect(body.input).toBe("hello");
      expect(Object.keys(body)).toEqual(["model", "input"]);
    });

    it("adds a system input item to a Responses input array", async () => {
      const inject = await load();
      const body = { model: "m", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
      inject(body, "openai", "full");
      expect(body.input[0]).toMatchObject({ type: "message", role: "system" });
      expect(body.input[0].content[0].text).toBeTruthy();
    });

    it("appends to the Claude system field", async () => {
      const inject = await load();
      const stringBody = { model: "m", system: "base", messages: [] };
      inject(stringBody, "claude", "full");
      expect(stringBody.system.startsWith("base")).toBe(true);
      expect(stringBody.system.length).toBeGreaterThan(4);

      const arrayBody = { model: "m", system: [{ type: "text", text: "base", cache_control: { type: "ephemeral" } }], messages: [] };
      inject(arrayBody, "claude", "full");
      expect(arrayBody.system).toHaveLength(2);
      // insert occurs before the last cache_control block
      expect(arrayBody.system[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("writes Gemini systemInstruction and honours the snake_case key", async () => {
      const inject = await load();
      const camel = { model: "m", contents: [] };
      inject(camel, "gemini", "full");
      expect(camel.systemInstruction.parts[0].text).toBeTruthy();
      expect(camel.system_instruction).toBeUndefined();

      const snake = { model: "m", system_instruction: { parts: [] } };
      inject(snake, "gemini", "full");
      expect(snake.system_instruction.parts).toHaveLength(1);
      expect(snake.systemInstruction).toBeUndefined();

      // Antigravity wraps the shape in body.request
      const wrapped = { model: "m", request: { contents: [] } };
      inject(wrapped, "antigravity", "full");
      expect(wrapped.request.systemInstruction.parts[0].text).toBeTruthy();
      expect(wrapped.systemInstruction).toBeUndefined();
    });

    it("writes the Kiro user turn and never sets systemPrompt", async () => {
      const inject = await load();
      const body = { model: "m", conversationState: { history: [{ userInputMessage: { content: "base" } }] } };
      inject(body, "kiro", "full");
      expect(body.conversationState.history[0].userInputMessage.content.startsWith("base")).toBe(true);
      expect(body.systemPrompt).toBeUndefined();
    });

    it("is idempotent across retries", async () => {
      const inject = await load();
      const body = { model: "m", messages: [{ role: "system", content: "base" }] };
      inject(body, "openai", "full");
      const once = body.messages[0].content;
      inject(body, "openai", "full");
      expect(body.messages[0].content).toBe(once);
    });

    it("never touches routing fields", async () => {
      const inject = await load();
      const body = {
        model: "m", stream: true, temperature: 0.5, top_p: 0.9, max_tokens: 10,
        tools: [{ type: "function" }], tool_choice: "auto", metadata: { a: 1 },
        forward_compatible_field: { keep: true },
        messages: [{ role: "user", content: "hi" }],
      };
      const before = JSON.parse(JSON.stringify(body));
      inject(body, "openai", "full");
      for (const key of ["model", "stream", "temperature", "top_p", "max_tokens", "tools", "tool_choice", "metadata", "forward_compatible_field"]) {
        expect(body[key]).toEqual(before[key]);
      }
    });
  });

  it("Ponytail and Caveman compose without throwing", async () => {
    const { injectPonytail } = await import("open-sse/rtk/ponytail.js");
    const { injectCaveman } = await import("open-sse/rtk/caveman.js");
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "openai", "full");
    const afterCaveman = body.messages.find(m => m.role === "system").content;
    injectPonytail(body, "openai", "full");
    const afterBoth = body.messages.find(m => m.role === "system").content;
    expect(afterBoth.startsWith(afterCaveman)).toBe(true);
    expect(afterBoth.length).toBeGreaterThan(afterCaveman.length);
  });
});

// PRD 23 / transform-field-map.md RTK row: compression rewrites text already
// present in tool results, at each wire shape, and never adds top-level fields.
describe("RTK field map", () => {
  const load = async () => (await import("open-sse/rtk/index.js")).compressMessages;

  // Must exceed MIN_COMPRESS_SIZE (500) and look like dedup-log noise, or RTK
  // correctly no-ops and the assertion would test nothing.
  // dedupLog only collapses *consecutive* duplicates, so emit long runs.
  const noisy = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 20 }, () => `warn retrying transport handshake for provider node ${i}`).join("\n")
  ).join("\n");

  it("fixture actually exceeds the compress threshold", async () => {
    const { MIN_COMPRESS_SIZE } = await import("open-sse/rtk/constants.js");
    expect(noisy.length).toBeGreaterThan(MIN_COMPRESS_SIZE);
  });

  it("is a no-op when disabled", async () => {
    const compress = await load();
    const body = { messages: [{ role: "tool", content: noisy }] };
    expect(compress(body, false)).toBeNull();
    expect(body.messages[0].content).toBe(noisy);
  });

  it("compresses an OpenAI string tool message", async () => {
    const compress = await load();
    const body = { model: "m", messages: [{ role: "user", content: "hi" }, { role: "tool", content: noisy }] };
    const stats = compress(body, true);
    expect(stats).toBeTruthy();
    expect(body.messages[0].content).toBe("hi");
    expect(body.messages[1].content.length).toBeLessThan(noisy.length);
  });

  it("compresses an OpenAI array tool message", async () => {
    const compress = await load();
    const body = { messages: [{ role: "tool", content: [{ type: "text", text: noisy }] }] };
    expect(compress(body, true)).toBeTruthy();
    expect(body.messages[0].content[0].text.length).toBeLessThan(noisy.length);
  });

  it("compresses a Claude tool_result block", async () => {
    const compress = await load();
    const body = { messages: [{ role: "user", content: [{ type: "tool_result", content: noisy }] }] };
    expect(compress(body, true)).toBeTruthy();
    expect(body.messages[0].content[0].content.length).toBeLessThan(noisy.length);
  });

  it("compresses a Responses function_call_output", async () => {
    const compress = await load();
    const body = { input: [{ type: "message", role: "user", content: "hi" }, { type: "function_call_output", output: noisy }] };
    expect(compress(body, true)).toBeTruthy();
    expect(body.input[0].content).toBe("hi");
    expect(body.input[1].output.length).toBeLessThan(noisy.length);
  });

  it("compresses a Kiro tool result and leaves systemPrompt alone", async () => {
    const compress = await load();
    const body = { conversationState: { history: [{ userInputMessage: { userInputMessageContext: { toolResults: [{ content: [{ text: noisy }] }] } } }] } };
    expect(compress(body, true)).toBeTruthy();
    const turn = body.conversationState.history[0].userInputMessage;
    expect(turn.userInputMessageContext.toolResults[0].content[0].text.length).toBeLessThan(noisy.length);
    expect(body.systemPrompt).toBeUndefined();
  });

  it("preserves error traces", async () => {
    const compress = await load();
    const claude = { messages: [{ role: "user", content: [{ type: "tool_result", is_error: true, content: noisy }] }] };
    compress(claude, true);
    expect(claude.messages[0].content[0].content).toBe(noisy);

    const kiro = { conversationState: { history: [{ userInputMessage: { userInputMessageContext: { toolResults: [{ status: "error", content: [{ text: noisy }] }] } } }] } };
    compress(kiro, true);
    expect(kiro.conversationState.history[0].userInputMessage.userInputMessageContext.toolResults[0].content[0].text).toBe(noisy);
  });
});
