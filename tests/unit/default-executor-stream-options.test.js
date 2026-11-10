import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DefaultExecutor stream_options", () => {
  const ex = new DefaultExecutor("openai");
  it("drops stream_options on non-streaming requests", () => {
    const body = { model: "m", messages: [], stream_options: { include_usage: true } };
    const out = ex.transformRequest("m", body, false);
    expect(out.stream_options).toBeUndefined();
    expect(body.stream_options).toBeDefined();
  });
  it("keeps stream_options when streaming", () => {
    const out = ex.transformRequest("m", { model: "m", messages: [], stream: true, stream_options: { include_usage: true } }, true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });
});
