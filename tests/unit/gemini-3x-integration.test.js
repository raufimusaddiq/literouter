import { afterEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

const VERSIONS = [
  {
    version: "3.7",
    upstreamFor: (tier) => `gemini-3.7-flash-tiered(${tier})`,
    finalModelFor: () => "gemini-3.7-flash-tiered",
  },
  {
    version: "3.8",
    upstreamFor: (tier) => `gemini-3.8-flash-${tier}(${tier})`,
    finalModelFor: (tier) => `gemini-3.8-flash-${tier}`,
  },
];

describe.each(VERSIONS)("Gemini $version Antigravity tiers", ({ version, upstreamFor, finalModelFor }) => {
  it.each(["high", "medium", "low"])(
    "maps the %p tier to the shared upstream model with matching thinking level",
    (tier) => {
      const publicModel = `gemini-${version}-flash-${tier}`;
      const upstreamModel = getModelUpstreamId("ag", publicModel);
      const body = {
        model: stripThinkingSuffix(upstreamModel),
        request: {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
          generationConfig: {},
        },
      };

      applyThinking("antigravity", upstreamModel, body, "antigravity");
      const finalBody = new AntigravityExecutor().transformRequest(
        publicModel,
        body,
        true,
        { projectId: "project", connectionId: "connection" }
      );

      expect(upstreamModel).toBe(upstreamFor(tier));
      expect(finalBody.model).toBe(finalModelFor(tier));
      expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: tier,
        includeThoughts: true,
      });
    }
  );
});

describe.each(VERSIONS)("Gemini $version MITM tools and catalog", ({ version }) => {
  it(`exposes the direct Gemini ${version} API models and pricing`, () => {
    const ids = gemini.models.map((model) => model.id);
    expect(ids).toContain(`gemini-${version}-flash`);
    expect(MODEL_PRICING[`gemini-${version}-flash`]).toMatchObject({ input: 1.5, output: 7.5 });
  });

  it("keeps the standalone CLI Antigravity catalog synchronized", () => {
    const source = readFileSync(join(here, "../../cli/src/cli/menus/providers.js"), "utf8");
    const agCatalog = source.match(/\n  ag: \[([\s\S]*?)\n  \],/)?.[1] || "";

    expect(agCatalog).toContain(`gemini-${version}-flash-high`);
    expect(agCatalog).toContain(`gemini-${version}-flash-medium`);
    expect(agCatalog).toContain(`gemini-${version}-flash-low`);
  });
});
