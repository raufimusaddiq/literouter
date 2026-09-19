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
      "/dashboard/console-log",
      "/dashboard/mitm",
      "/dashboard/media-providers",
      "/dashboard/proxy-pools",
      "/dashboard/skills",
      "/dashboard/translator",
      "/api/version/update",
      "/api/version/shutdown",
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

  // PRD 18 removes Cloudflare Tunnel and Tailscale provisioning. Hiding their
  // routes is not enough: the retained Endpoint page still advertised both and
  // polled /api/tunnel/status, which 404s under the minimal profile.
  it("does not advertise tunnel or Tailscale on the retained Endpoint page", () => {
    const page = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url),
      "utf8"
    );
    expect(page).toContain("minimalProfile");
    // Both the Cloudflare Tunnel block and the Tailscale block must sit behind
    // the same guard, and the tunnel status fetch must be skipped entirely.
    expect(page).toMatch(/!minimalProfile && \(/);
    expect(page).toMatch(/data\.minimalProfile === true/);
    expect(page).toMatch(/minimalProfile && isLoginUnsafe/);
  });
});
