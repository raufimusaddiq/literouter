import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const source = readFileSync(new URL("../../src/server/guard.js", import.meta.url), "utf8");
const hiddenBlock = source.match(/MINIMAL_HIDDEN_PREFIXES = \[([\s\S]*?)\];/)?.[1] || "";
const hidden = [...hiddenBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe("minimal profile route boundary", () => {
  it("gates on MINIMAL_PROFILE", () => {
    expect(source).toContain('process.env.MINIMAL_PROFILE === "true"');
  });

  it("does not retain deleted product surfaces in the guard", () => {
    expect(hidden).not.toContain("/api/mcp");
    expect(hidden).not.toContain("/api/version/update");
    expect(hidden).not.toContain("/api/version/shutdown");
  });

  it("deletes Basic Chat instead of hiding a live route", () => {
    expect(hidden).not.toContain("/dashboard/basic-chat");
    expect(() =>
      readFileSync(
        new URL("../../src/web/pages/dashboard/basic-chat/page.js", import.meta.url)
      )
    ).toThrow();
  });

  it("deletes the media surfaces instead of hiding them", () => {
    for (const path of [
      "../../src/web/pages/dashboard/media-providers/[kind]/page.js",
      "../../src/app/api/media-providers/tts/voices/route.js",
      "../../src/app/api/v1/audio/voices/route.js",
      "../../src/app/api/v1/audio/speech/route.js",
      "../../src/app/api/v1/audio/transcriptions/route.js",
      "../../src/sse/handlers/tts.js",
      "../../src/sse/handlers/stt.js",
      "../../src/shared/constants/ttsProviders.js",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url)), path).toThrow();
    }
    expect(hidden).not.toContain("/dashboard/media-providers");
    expect(hidden).not.toContain("/api/media-providers");
  });

  it("deletes the CLI-tools and MITM surfaces instead of hiding them", () => {
    for (const path of [
      "../../src/web/pages/dashboard/cli-tools/page.js",
      "../../src/web/pages/dashboard/mitm/page.js",
      "../../src/app/api/cli-tools/all-statuses/route.js",
      "../../src/app/api/cli-tools/cowork-mcp-tools/route.js",
      "../../src/shared/constants/cliTools.js",
      "../../src/lib/mitmAliasCache.js",
      "../../src/shared/components/McpMarketplaceModal.js",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url)), path).toThrow();
    }
    expect(hidden).not.toContain("/dashboard/cli-tools");
    expect(hidden).not.toContain("/dashboard/mitm");
    expect(hidden).not.toContain("/api/cli-tools");
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

  it("deletes tunnel, Tailscale, and the Endpoint page's tunnel UI", () => {
    const page = readFileSync(
      new URL("../../src/web/pages/dashboard/endpoint/EndpointPageClient.js", import.meta.url),
      "utf8"
    );
    expect(page).not.toMatch(/\/api\/tunnel\//);
    expect(page).not.toMatch(/Tailscale/);
    expect(page).not.toContain("showEnableTunnelModal");

    for (const path of [
      "../../src/lib/tunnel/index.js",
      "../../src/app/api/tunnel/status/route.js",
      "../../src/mitm/manager.js",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url)), path).toThrow();
    }
  });

  it("deletes tunnel and MITM compatibility branches after their runtimes", () => {
    const settings = readFileSync(
      new URL("../../src/lib/db/repos/settingsRepo.js", import.meta.url),
      "utf8"
    );
    const db = readFileSync(new URL("../../src/lib/db/index.js", import.meta.url), "utf8");
    const defaults = settings.match(/const DEFAULT_SETTINGS = \{([\s\S]*?)\n\};/)?.[1] || "";
    expect(defaults).not.toMatch(/tunnel|tailscale|mitmRouterBaseUrl|mitmSudoEncrypted/);
    expect(db).not.toContain("mitmAlias");
    expect(source).not.toMatch(/tunnelDashboardAccess|tunnelUrl|tailscaleUrl/);
  });

  it("does not retain tunnel or MITM helpers in the CLI or request path", () => {
    const cli = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
    const cliBuild = readFileSync(new URL("../../cli/scripts/build-cli.js", import.meta.url), "utf8");
    const fetcher = readFileSync(new URL("../../open-sse/utils/proxyFetch.js", import.meta.url), "utf8");

    expect(cli).not.toMatch(/mitm|tunnel|tailscale|cloudflared/i);
    expect(cliBuild).not.toMatch(/mitm/i);
    expect(fetcher).not.toMatch(/mitm|bypass DNS|got-scraping/i);
    expect(() => readFileSync(new URL("../../cli/scripts/buildMitm.js", import.meta.url))).toThrow();
  });

  it("deletes unused init and shutdown endpoints", () => {
    for (const path of [
      "../../src/app/api/init/route.js",
      "../../src/app/api/shutdown/route.js",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url)), path).toThrow();
    }
    expect(source).not.toContain('"/api/init"');
    expect(source).not.toContain('"/api/shutdown"');
  });

  it("deletes docs and skills that describe the unminimalized product", () => {
    for (const path of [
      "../../docs/ARCHITECTURE.md",
      "../../skills/README.md",
      "../../skills/9router/SKILL.md",
      "../../skills/9router-chat/SKILL.md",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url)), path).toThrow();
    }
    const claude = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
    expect(claude).not.toMatch(/optional cloud sync/);
    expect(claude).not.toContain("docs/ARCHITECTURE.md");
  });

  it("deletes the Proxy Pools UI and deploy routes", () => {
    for (const path of [
      "../../src/web/pages/dashboard/proxy-pools/page.js",
      "../../src/app/api/proxy-pools/cloudflare-deploy/route.js",
      "../../src/app/api/proxy-pools/deno-deploy/route.js",
      "../../src/app/api/proxy-pools/vercel-deploy/route.js",
    ]) {
      expect(() => readFileSync(new URL(path, import.meta.url))).toThrow();
    }
    expect(hidden).not.toContain("/api/proxy-pools");
  });

  it("deletes external promotional links from the sidebar", () => {
    const sidebar = readFileSync(
      new URL("../../src/shared/components/Sidebar.js", import.meta.url),
      "utf8"
    );
    expect(sidebar).not.toContain("9English");
    expect(sidebar).not.toContain("9Remote");
  });

  it("retains the Console Log page, its sidebar entry, and its API", () => {
    expect(hidden).not.toContain("/dashboard/console-log");

    const sidebar = readFileSync(
      new URL("../../src/shared/components/Sidebar.js", import.meta.url),
      "utf8"
    );
    expect(sidebar).toContain('"/dashboard/console-log"');
    expect(sidebar).not.toContain("nonMinimal");

    const shadowed = hidden.some(
      (h) => "/api/console-logs" === h || "/api/console-logs".startsWith(h)
    );
    expect(shadowed, "/api/console-logs must not be hidden").toBe(false);
    expect(hidden).not.toContain("/api/translator");

    const protectedBlock = source.match(/const PROTECTED_API_PATHS = \[([\s\S]*?)\];/)?.[1] || "";
    expect(protectedBlock).toContain('"/api/console-logs"');
  });
});
