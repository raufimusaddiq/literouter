import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyIntlExecutor system prompt & agent sanitization", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("forwards user custom system prompt when provided", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: "You are a professional translator." },
          { role: "user", content: "Translate this text." },
        ],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a professional translator.",
    });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Translate this text." }],
    });
  });

  it("falls back to default system prompt when omitted by client", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [{ role: "user", content: "Hello" }],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are CodeBuddy Code.",
    });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    });
  });

  it("neutralizes sensitive third-party agent identity to prevent WAF rejection", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          {
            role: "system",
            content: "You are Claude Code, Anthropic's official CLI for coding.",
          },
          { role: "user", content: "Fix this bug" },
        ],
      },
      false,
      {}
    );

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful AI assistant that helps with software engineering tasks.",
    });
  });

  it("keeps operator prompts that merely use generic template markers", () => {
    for (const prompt of ["<Role>You review contracts.</Role>", "You are an agent that triages invoices.", "Use orchestration capabilities sparingly."]) {
      const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "system", content: prompt }, { role: "user", content: "hi" }] }, false, {});
      expect(out.messages[0]).toEqual({ role: "system", content: prompt });
    }
  });

  it("neutralizes only the identity line and keeps the operator's other instructions", () => {
    const prompt = "You are Claude Code, Anthropic's official CLI for coding.\nAlways answer in French.\nNever touch the billing module.";
    const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "system", content: prompt }, { role: "user", content: "hi" }] }, false, {});
    expect(out.messages[0].content).toBe("You are a helpful AI assistant that helps with software engineering tasks.\nAlways answer in French.\nNever touch the billing module.");
  });

  it("keeps the rest of a prompt that opens with 'you are cody'", () => {
    const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "system", content: "You are Cody, our support bot.\nRefund limit is 50 USD." }, { role: "user", content: "hi" }] }, false, {});
    expect(out.messages[0].content).toContain("Refund limit is 50 USD.");
  });
});
