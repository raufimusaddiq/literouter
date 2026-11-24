import { describe, expect, it } from "bun:test";

const { buildProviderHeader, groupModelsByAlias } = require("../src/cli/menus/providers");

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("provider menu model header", () => {
  it("groups the server's models under their routed alias", () => {
    const grouped = groupModelsByAlias([
      { routedModel: "cx/gpt-5.2", model: "gpt-5.2" },
      { routedModel: "cc/claude-opus-4-5-20251101", model: "claude-opus-4-5-20251101" },
      { routedModel: "cx/gpt-5.2-codex", model: "gpt-5.2-codex" },
      { routedModel: "broken" },
    ]);

    expect(grouped).toEqual({
      cx: ["gpt-5.2", "gpt-5.2-codex"],
      cc: ["claude-opus-4-5-20251101"],
    });
  });

  it("labels the models of the selected provider with its alias", () => {
    const grouped = groupModelsByAlias([{ routedModel: "cc/claude-opus-4-5-20251101", model: "claude-opus-4-5-20251101" }]);

    expect(strip(buildProviderHeader("claude", grouped))).toBe(
      "Alias: cc\nModels: cc/claude-opus-4-5-20251101"
    );
  });

  it("shows five models and counts the remaining ones", () => {
    const models = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ routedModel: `cx/${id}`, model: id }));

    expect(strip(buildProviderHeader("codex", groupModelsByAlias(models)))).toContain(
      "Models: cx/a, cx/b, cx/c, cx/d, cx/e (+2 more)"
    );
  });

  it("says the server is not running when the models request fails", () => {
    expect(strip(buildProviderHeader("claude", null))).toContain("Unavailable (server not running)");
  });

  it("says no models are configured when the server returns none for the provider", () => {
    expect(strip(buildProviderHeader("claude", {}))).toContain("No models configured");
  });
});
