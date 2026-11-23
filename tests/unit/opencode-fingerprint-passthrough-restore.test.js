import { describe, it, expect } from "bun:test";

import { applyFingerprintTools, restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";
import { createSSEStream, createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const CALLER_TOOLS = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file the caller declared itself.",
      parameters: { type: "object", properties: { filePath: { type: "string" } } },
    },
  },
];

function bodyWithCallerRead() {
  return {
    messages: [{ role: "user", content: "read a.txt" }],
    tools: CALLER_TOOLS,
  };
}

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function runPassthrough({ toolNameMap, toolName = "read" }) {
  const chunk = {
    id: "chatcmpl-abc12345",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "m",
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: toolName, arguments: "{\"filePath\":\"a.txt\"}" },
        }],
      },
      finish_reason: null,
    }],
  };
  const sse = `data: ${JSON.stringify(chunk)}\n\n` + "data: [DONE]\n\n";

  const stream = createPassthroughStreamWithLogger("opencode", null, "m", "c1", null, null, null, toolNameMap);
  const writer = stream.writable.getWriter();
  const readPromise = drain(stream.readable);
  await writer.write(new TextEncoder().encode(sse));
  await writer.close();
  return readPromise;
}

describe("opencode fingerprint — tool name restore on the passthrough path", () => {
  it("canonicalises a case-variant caller tool to the fingerprint name", () => {
    const body = bodyWithCallerRead();
    const map = applyFingerprintTools(body, false);

    expect(map.get("read")).toBe("Read");
    const names = body.tools.map((t) => t.function?.name);
    expect(names).toContain("read");
    expect(names).not.toContain("Read");
  });

  it("restores the caller's tool name in the passthrough stream", async () => {
    const body = bodyWithCallerRead();
    const map = applyFingerprintTools(body, false);

    const out = await runPassthrough({ toolNameMap: map });

    expect(out).not.toContain('"name":"read"');
    expect(out).toContain('"name":"Read"');
  });

  it("leaves a tool name the map does not cover alone", async () => {
    const out = await runPassthrough({ toolNameMap: new Map(), toolName: "read" });

    expect(out).toContain('"name":"read"');
  });

  it("forwards the chunk untouched when there is no rename map", async () => {
    const out = await runPassthrough({ toolNameMap: null, toolName: "read" });

    expect(out).toContain('"name":"read"');
  });

  it("still restores the name in a translated (non-passthrough) stream", async () => {
    const map = new Map([["read", "Read"]]);
    const chunk = {
      id: "chatcmpl-abc12345",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "m",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "read", arguments: "{}" },
          }],
        },
        finish_reason: null,
      }],
    };

    const restored = restoreToolNames(chunk, map);
    expect(restored.choices[0].delta.tool_calls[0].function.name).toBe("Read");
  });
});
