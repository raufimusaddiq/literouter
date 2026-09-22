import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, isValidModel } from "@/shared/constants/models.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";

// gpt-6-sol / gpt-6-luna were reachable on the Codex endpoint but missing from the
// registry, so isValidModel() rejected them and they only worked as custom models.
describe("Codex gpt-6 models", () => {
  const codex = PROVIDER_MODELS.cx || [];
  const byId = (id) => codex.find((m) => m.id === id);

  it.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"])("registers %s", (id) => {
    expect(byId(id), `${id} missing from the cx registry`).toBeDefined();
    expect(isValidModel("cx", id)).toBe(true);
  });

  it("does not register review variants for gpt-6", () => {
    // withCodexReviewModels() is imported but never applied to this array, and the
    // gpt-6 review variants were dropped on purpose. Guard against a stray line
    // re-adding one without the upstreamModelId wiring.
    expect(codex.filter((m) => m.id.startsWith("gpt-6-") && m.id.endsWith("-review"))).toEqual([]);
  });

  it("prices every gpt-6 model", () => {
    for (const model of codex.filter((m) => m.id.startsWith("gpt-6-"))) {
      const pricing = getPricingForModel("cx", model.id);
      expect(pricing?.input, `${model.id} has no input price`).toBeGreaterThan(0);
      expect(pricing?.output, `${model.id} has no output price`).toBeGreaterThan(0);
    }
  });

  it("keeps the gpt-6 generation cheaper than gpt-5.6 on the same tier", () => {
    // sol was repriced from 5/30 (gpt-5.6) down to 2/10 in the gpt-6 generation.
    const sol = getPricingForModel("cx", "gpt-6-sol");
    const sol56 = getPricingForModel("cx", "gpt-5.6-sol");
    expect(sol.input).toBeLessThan(sol56.input);
    expect(sol.output).toBeLessThan(sol56.output);
  });
});
