import { describe, it, expect } from "bun:test";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CURSOR_IMAGE_PLACEHOLDER } from "../../open-sse/translator/request/openai-to-cursor.js";
import { openaiToGeminiCLIRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe("OpenAI → Gemini", () => {
  it("multiple system messages are all kept in order", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    });
    const texts = out.systemInstruction.parts.map((p) => p.text);
    expect(texts, "earlier system lost").toEqual(["RULE_ONE", "RULE_TWO"]);
  });

  it("the CLI and antigravity envelopes carry every system message", () => {
    const body = {
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    };
    const texts = (si) => si.parts.map((p) => p.text);
    const cli = openaiToGeminiCLIRequest("gemini-2.5-pro", body, true);
    const anti = openaiToAntigravityRequest("gemini-2.5-pro", body, true);
    expect(texts(cli.systemInstruction)).toEqual(["RULE_ONE", "RULE_TWO"]);
    expect(texts(anti.request.systemInstruction)).toEqual(["RULE_ONE", "RULE_TWO"]);
  });
});

describe("OpenAI → Cursor", () => {
  it("image content becomes an explicit placeholder", () => {
    const out = O2C({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    expect(JSON.stringify(out), "image dropped silently").toContain(CURSOR_IMAGE_PLACEHOLDER);
  });

  it("respects client max_tokens", () => {
    const out = O2C({ max_tokens: 200, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(200);
  });
});

describe("OpenAI → CommandCode", () => {
  it("malformed tool arguments are not silently emptied", () => {
    const out = O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    });
    const asst = out.params.messages.find((m) => m.role === "assistant");
    const call = asst.content.find((b) => b.type === "tool-call");
    expect(Object.keys(call.input).length, "arguments silently dropped to {}").toBeGreaterThan(0);
  });

  it("image content is preserved as native CommandCode image blocks", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    expect(JSON.stringify(out)).toContain("BBBB");
    expect(JSON.stringify(out)).not.toContain("[image omitted]");
    expect(out.params.messages[0].content).toEqual([
      { type: "text", text: "look" },
      {
        type: "image",
        image: "data:image/png;base64,BBBB",
        mimeType: "image/png",
        mediaType: "image/png",
      },
    ]);
  });
});
