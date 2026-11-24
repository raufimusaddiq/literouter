import { describe, expect, it } from "bun:test";

const { buildProviderHeader, groupModelsByAlias, fetchModelsByAlias } = require("../src/cli/menus/providers");

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("provider menu model header", () => {
  it("groups the server's models under their routed alias", () => {
    const grouped = groupModelsByAlias([
      { routedModel: "cx/gpt-5.2", model: "gpt-5.2" },
      { routedModel: "cc/model-a", model: "model-a" },
      { routedModel: "cx/gpt-5.2-codex", model: "gpt-5.2-codex" },
      { routedModel: "broken" },
    ]);

    expect(grouped).toEqual({
      cx: ["gpt-5.2", "gpt-5.2-codex"],
      cc: ["model-a"],
    });
  });

  it("labels the models of the selected provider with its alias", () => {
    const grouped = groupModelsByAlias([{ routedModel: "cc/model-a", model: "model-a" }]);

    expect(strip(buildProviderHeader("claude", grouped))).toBe(
      "Alias: cc\nModels: cc/model-a"
    );
  });

  it("shows five models and counts the remaining ones", () => {
    const models = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ routedModel: `cx/${id}`, model: id }));

    expect(strip(buildProviderHeader("codex", groupModelsByAlias(models)))).toContain(
      "Models: cx/a, cx/b, cx/c, cx/d, cx/e (+2 more)"
    );
  });

  it("says the server is not running when the models request fails", async () => {
    const api = require("../src/cli/api/client");
    const original = api.getModels;
    api.getModels = async () => ({ success: false, error: "Request timeout" });
    try {
      expect(strip(buildProviderHeader("claude", await fetchModelsByAlias()))).toContain(
        "Unavailable (server not running)"
      );
    } finally {
      api.getModels = original;
    }
  });

  it("says no models are configured when the server returns none for the provider", () => {
    expect(strip(buildProviderHeader("claude", {}))).toContain("No models configured");
  });
});
