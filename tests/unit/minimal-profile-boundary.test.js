import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");
const hiddenBlock = source.match(/MINIMAL_HIDDEN_PREFIXES = \[([\s\S]*?)\];/)?.[1] || "";
const hidden = [...hiddenBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe("minimal profile route boundary", () => {
  it("gates on MINIMAL_PROFILE", () => {
    expect(source).toContain('process.env.MINIMAL_PROFILE === "true"');
  });

  it("hides the non-retained product surfaces", () => {
    for (const prefix of [
      "/dashboard/basic-chat",
      "/dashboard/cli-tools",
      "/dashboard/mitm",
      "/dashboard/media-providers",
      "/dashboard/proxy-pools",
      "/dashboard/skills",
      "/dashboard/translator",
    ]) {
      expect(hidden).toContain(prefix);
    }
  });

  it("never shadows a retained API", () => {
    for (const retained of [
      "/api/providers",
      "/api/combos",
      "/api/usage",
      "/api/models",
      "/api/provider-nodes",
      "/api/keys",
      "/api/settings",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/messages",
    ]) {
      const shadowed = hidden.some((h) => retained === h || retained.startsWith(`${h}/`) || retained.startsWith(h));
      expect(shadowed, `${retained} must not be hidden`).toBe(false);
    }
  });
});
