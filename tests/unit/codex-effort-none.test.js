import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

function effortFor(model, requested) {
  const body = {
    model,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    reasoning_effort: requested,
    stream: true,
  };
  new CodexExecutor().transformRequest(model, body, true, { connectionId: "effort-test", providerSpecificData: {} });
  return body.reasoning.effort;
}

function streamOf(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("Codex reasoning effort none", () => {
  it("maps none to the lowest supported level on gpt-6.1-sol, which rejects it upstream", () => {
    expect(effortFor("gpt-6.1-sol", "none")).toBe("low");
  });

  it("keeps none for models that accept it", () => {
    expect(effortFor("gpt-6-luna", "none")).toBe("none");
  });
});

describe("Responses stream failures", () => {
  it("reports an error event as a failed response with its message", async () => {
    const error = { type: "invalid_request_error", message: "bad effort" };
    const result = await convertResponsesStreamToJson(streamOf(`event: error\ndata: ${JSON.stringify({ error })}\n\n`));
    expect(result.status).toBe("failed");
    expect(result.error).toEqual(error);
  });

  it("keeps in_progress when the stream ends without a terminal event", async () => {
    const result = await convertResponsesStreamToJson(streamOf(`event: response.created\ndata: ${JSON.stringify({ response: { id: "r" } })}\n\n`));
    expect(result.status).toBe("in_progress");
    expect(result.output).toEqual([]);
  });
});
