import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoPath = (p) => path.join(REPO_ROOT, p);

describe("AUDIT-002: API key masking", () => {
  it("source should contain maskApiKey function", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    expect(source).toContain("function maskApiKey");
  });

  it("getUsageStats should use apiKeyMasked in byApiKey entries", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    const maskedCount = (source.match(/apiKeyMasked/g) || []).length;
    expect(maskedCount).toBeGreaterThanOrEqual(4);

    const dailyPath = source.match(/stats\.byApiKey\[akKey\] = \{[^}]*apiKeyMasked[^}]*\}/);
    expect(dailyPath).not.toBeNull();
    const livePath = source.match(/stats\.byApiKey\[akKey\] = \{[^}]*apiKeyMasked[^}]*\}/g);
    expect(livePath).not.toBeNull();
    expect(livePath.length).toBeGreaterThanOrEqual(1);
  });

  it("byApiKey object keys should use masked key, not raw key", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/db/repos/usageRepo.js"),
      "utf-8"
    );
    expect(source).toContain("${apiKeyMasked}|${r.model}|${r.provider");
    expect(source).not.toContain("${r.apiKey}|${r.model}|${r.provider");
  });
});

describe("AUDIT-003: Proxy URL validation", () => {
  beforeEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
    delete process.env.NINE_ROUTER_PROXY_URL;
    delete process.env.NINE_ROUTER_NO_PROXY;
    delete process.env.NO_PROXY;
  });

  it("source should contain validateProxyUrl function", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/network/outboundProxy.js"),
      "utf-8"
    );
    expect(source).toContain("function validateProxyUrl");
    expect(source).toContain("ALLOWED_PROXY_SCHEMES");
  });

  it("should accept valid http proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxy.example.com:8080",
    });
    expect(process.env.HTTP_PROXY).toContain("http://proxy.example.com:8080");
    expect(process.env.HTTPS_PROXY).toContain("http://proxy.example.com:8080");
  });

  it("should accept valid https proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "https://proxy.example.com:443",
    });
    expect(process.env.HTTP_PROXY).toContain("https://proxy.example.com");
  });

  it("should accept valid socks5 proxy URLs", async () => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl: "socks5://proxy.example.com:1080",
    });
    expect(process.env.ALL_PROXY).toBe("socks5://proxy.example.com:1080");
  });

  it.each([
    ["should reject URLs with shell metacharacters (newline)", "http://proxy.example.com:8080\nmalicious"],
    ["should reject URLs with shell metacharacters (backtick)", "http://`whoami`.example.com:8080"],
    ["should reject URLs with shell metacharacters (dollar)", "http://$(whoami).example.com:8080"],
    ["should reject non-allowed schemes (file://)", "file:///etc/passwd"],
    ["should reject non-allowed schemes (javascript:)", "javascript:alert(1)"],
  ])("%s", async (_label, outboundProxyUrl) => {
    vi.resetModules();
    const { applyOutboundProxyEnv } = await import("../../src/lib/network/outboundProxy.js");
    applyOutboundProxyEnv({
      outboundProxyEnabled: true,
      outboundProxyUrl,
    });
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });
});

describe("AUDIT-018: XSS escaping in OAuth callback", () => {
  it("source should contain escapeHtml function", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/oauth/utils/server.js"),
      "utf-8"
    );
    expect(source).toContain("function escapeHtml");
  });

  it("should escape ampersand, angle brackets, and quotes", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/oauth/utils/server.js"),
      "utf-8"
    );
    expect(source).toContain("&amp;");
    expect(source).toContain("&lt;");
    expect(source).toContain("&gt;");
    expect(source).toContain("&quot;");
    expect(source).toContain("&#39;");
  });

  it("should use safeMessage in rendered HTML, not raw message", () => {
    const source = fs.readFileSync(
      repoPath("src/lib/oauth/utils/server.js"),
      "utf-8"
    );
    expect(source).toContain("safeMessage");
    expect(source).toContain("${safeMessage}");
    expect(source).not.toContain("<p>${message}</p>");
  });
});

