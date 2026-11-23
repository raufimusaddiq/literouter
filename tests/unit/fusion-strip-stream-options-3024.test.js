
import { describe, it, expect, vi } from "vitest";
import { handleFusionChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, error: () => {} };

function makeBody(extra = {}) {
  return {
    model: "combo/gemseek",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "hi" }],
    ...extra,
  };
}

describe("Fusion strips stream_options (#3024)", () => {
  it("removes stream_options before fanning out to panel models", async () => {
    let capturedPanelBody = null;
    const handleSingleModel = vi.fn(async (panelBody, model, isPanel) => {
      if (isPanel) capturedPanelBody = panelBody;
      if (isPanel) {
        return new Response(JSON.stringify({ choices: [{ message: { content: `ans-${model}` } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "final" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await handleFusionChat({
      body: makeBody(),
      models: ["ds/deepseek-v4-flash", "gemini/gemini-3.5-flash-lite"],
      handleSingleModel,
      log,
      comboName: "GemSeek",
      judgeModel: "gemini/gemini-3.5-flash-lite",
    });

    expect(res).toBeInstanceOf(Response);
    expect(capturedPanelBody).not.toBeNull();
    expect(capturedPanelBody.stream_options).toBeUndefined();
    expect(capturedPanelBody.stream).toBe(false);
    expect(makeBody().stream_options).toBeDefined();
  });

  it("does not throw for a 2-model fusion with stream_options present", async () => {
    const handleSingleModel = vi.fn(async (panelBody, model, isPanel) => {
      if (isPanel) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "final" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await handleFusionChat({
      body: makeBody({ stream_options: { include_usage: true } }),
      models: ["ds/deepseek-v4-pro", "ds/deepseek-v4-flash"],
      handleSingleModel,
      log,
      comboName: "GemSeek",
      judgeModel: "ds/deepseek-v4-pro",
    });

    expect(res.status).toBe(200);
  });
});
