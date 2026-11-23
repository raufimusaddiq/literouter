import { describe, expect, it } from "bun:test";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const credentials = { projectId: "synthetic-project", connectionId: "synthetic-connection" };

const antigravityBody = (stream) => ({
  stream,
  stream_options: { include_usage: true },
  request: { contents: [{ role: "user", parts: [{ text: "Reply only OK" }] }] },
});

describe("executor stream_options normalization", () => {
  it("antigravity removes stream_options from a non-streaming request", () => {
    const output = new AntigravityExecutor().transformRequest("gpt-oss-120b-medium", antigravityBody(false), false, credentials);
    expect(output.stream).toBe(false);
    expect(output.stream_options).toBeUndefined();
  });

  it("antigravity preserves stream_options for a streaming request", () => {
    const output = new AntigravityExecutor().transformRequest("gpt-oss-120b-medium", antigravityBody(true), true, credentials);
    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({ include_usage: true });
  });

  it("default drops stream_options on non-streaming requests without mutating the input", () => {
    const body = { model: "m", messages: [], stream_options: { include_usage: true } };
    const out = new DefaultExecutor("openai").transformRequest("m", body, false);
    expect(out.stream_options).toBeUndefined();
    expect(body.stream_options).toBeDefined();
  });

  it("default keeps stream_options when streaming", () => {
    const out = new DefaultExecutor("openai").transformRequest("m", { model: "m", messages: [], stream: true, stream_options: { include_usage: true } }, true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });
});
