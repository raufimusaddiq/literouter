import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalFetch = global.fetch;

describe("Grok CLI (xAI) token expiry propagation (#2546)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("proactive refresh fires for a near-expiry grok-cli token (expiresAt present)", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const creds = {
      connectionId: "grok-1",
      refreshToken: "rt",
      expiresIn: 60,
      expiresAt: soon,
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(true);
  });

  it("proactive refresh does NOT fire for a far-future grok-cli token", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const creds = {
      connectionId: "grok-2",
      refreshToken: "rt",
      expiresIn: 86400,
      expiresAt: farFuture,
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(false);
  });
});
