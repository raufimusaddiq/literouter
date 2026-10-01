import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, isValidModel } from "@/shared/constants/models.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { CodexExecutor } from "open-sse/executors/codex.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// gpt-6-sol / gpt-6-luna were reachable on the Codex endpoint but missing from the
// registry, so isValidModel() rejected them and they only worked as custom models.
describe("Codex gpt-6 models", () => {
  const codex = PROVIDER_MODELS.cx || [];
  const byId = (id) => codex.find((m) => m.id === id);

  it.each(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"])("registers %s", (id) => {
    expect(byId(id), `${id} missing from the cx registry`).toBeDefined();
    expect(isValidModel("cx", id)).toBe(true);
  });

  it("preserves the GPT 6.1 Sol wire ID and existing reasoning support", () => {
    const id = "gpt-6.1-sol";
    const executor = new CodexExecutor();
    const body = executor.transformRequest(id, {
      model: id,
      input: "hi",
      reasoning_effort: "max",
    }, true, {});
    expect(body.model).toBe(id);
    expect(body.reasoning.effort).toBe("max");
    expect(getCapabilitiesForModel("codex", id)).toMatchObject({ vision: true, reasoning: true });
    expect(executor.buildUrl(id, true)).toBe("https://chatgpt.com/backend-api/codex/responses");
  });

  it("uses the updated Codex CLI identity", () => {
    const headers = new CodexExecutor().buildHeaders({ accessToken: "test-token" }, true);
    expect(headers.version).toBe("0.159.0");
    expect(headers["User-Agent"]).toBe("codex_cli_rs/0.159.0");
  });

  it("does not register review variants for gpt-6", () => {
    // withCodexReviewModels() is imported but never applied to this array, and the
    // gpt-6 review variants were dropped on purpose. Guard against a stray line
    // re-adding one without the upstreamModelId wiring.
    expect(codex.filter((m) => m.id.startsWith("gpt-6") && m.id.endsWith("-review"))).toEqual([]);
  });

  it("prices every gpt-6 model", () => {
    for (const model of codex.filter((m) => m.id.startsWith("gpt-6"))) {
      const pricing = getPricingForModel("cx", model.id);
      expect(pricing?.input, `${model.id} has no input price`).toBeGreaterThan(0);
      expect(pricing?.output, `${model.id} has no output price`).toBeGreaterThan(0);
    }
  });

  it("uses GPT 6.1 Sol Standard rates for Codex estimates", () => {
    expect(getPricingForModel("cx", "gpt-6.1-sol")).toEqual({
      input: 2, output: 10, cached: 0.1, reasoning: 10, cache_creation: 2.5,
    });
  });

  it("keeps the gpt-6 generation cheaper than gpt-5.6 on the same tier", () => {
    // sol was repriced from 5/30 (gpt-5.6) down to 2/10 in the gpt-6 generation.
    const sol = getPricingForModel("cx", "gpt-6-sol");
    const sol56 = getPricingForModel("cx", "gpt-5.6-sol");
    expect(sol.input).toBeLessThan(sol56.input);
    expect(sol.output).toBeLessThan(sol56.output);
  });
});
