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

  // The sidebar advertised the upstream 9english.net marketing site. Under the
  // minimal profile the sidebar should carry only product navigation.
  it("does not link the external 9English site in the sidebar", () => {
    const sidebar = readFileSync(
      new URL("../../src/shared/components/Sidebar.js", import.meta.url),
      "utf8"
    );
    const link = sidebar.match(/\{\/\* 9English \*\/\}([\s\S]{0,80})/)?.[1] || "";
    expect(link).toContain("!minimalProfile && (");
  });

  // Console Log is retained: it is the only in-browser view of server-side
  // console output, and the retained Usage/details pages show request records
  // rather than the log stream. Its API also had to move off `/api/translator`,
  // a hidden prefix, or hiding the translator playground silently took the log
  // stream down with it.
  it("retains the Console Log page, its sidebar entry, and its API", () => {
    expect(hidden).not.toContain("/dashboard/console-log");

    const sidebar = readFileSync(
      new URL("../../src/shared/components/Sidebar.js", import.meta.url),
      "utf8"
    );
    const consoleLogEntry = sidebar.match(/\{[^}]*"\/dashboard\/console-log"[^}]*\}/)?.[0] || "";
    expect(consoleLogEntry).not.toBe("");
    expect(consoleLogEntry).not.toContain("nonMinimal");

    // The entry alone is not enough: the debug group it lives in must be
    // filtered per item rather than blanked wholesale, or the group's render
    // guard discards retained entries anyway. Assert the guard, not the array.
    expect(sidebar).toContain("debugItems.filter((item) => !minimalProfile || !item.nonMinimal)");
    expect(sidebar).not.toContain("minimalProfile ? [] : debugItems");

    // The log API must not sit under a hidden prefix. It used to live at
    // `/api/translator/console-logs`, which `/api/translator` shadowed.
    const shadowed = hidden.some(
      (h) => "/api/console-logs" === h || "/api/console-logs".startsWith(h)
    );
    expect(shadowed, "/api/console-logs must not be hidden").toBe(false);
    expect(hidden).toContain("/api/translator");

    // Moving the API off `/api/translator` also moved it off the auth
    // allowlist that prefix provided. It must be protected in its own right,
    // or the server log stream is readable unauthenticated.
    const protectedBlock = source.match(/const PROTECTED_API_PATHS = \[([\s\S]*?)\];/)?.[1] || "";
    expect(protectedBlock).toContain('"/api/console-logs"');
  });
});
