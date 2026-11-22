import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import antigravity, { resolveAntigravityRedirectUri } from "../../src/lib/oauth/providers/antigravity.js";
import { generateAuthData, exchangeTokens } from "../../src/lib/oauth/providers.js";
import { matchesOAuthState } from "../../src/shared/utils/oauthCallback.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Antigravity OAuth callbacks", () => {
  const fallback = "http://localhost:443/callback";
  const hosted = "https://ai.example.com:443/callback";

  it("keeps the loopback default and other providers unchanged", async () => {
    vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", "");
    expect(resolveAntigravityRedirectUri(fallback)).toBe(fallback);
    const local = await generateAuthData("antigravity", fallback);
    expect(local.redirectUri).toBe(fallback);
    expect(new URL(local.authUrl).searchParams.get("redirect_uri")).toBe(fallback);

    vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", hosted);
    const claude = await generateAuthData("claude", "http://localhost:20128/callback");
    expect(claude.redirectUri).toBe("http://localhost:20128/callback");
  });

  it("uses the exact configured URL for authorization and exchange", async () => {
    vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", ` ${hosted} `);
    const auth = await generateAuthData("antigravity", fallback);
    expect(auth.redirectUri).toBe(hosted);
    expect(new URL(auth.authUrl).searchParams.get("redirect_uri")).toBe(hosted);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(antigravity, "postExchange").mockResolvedValue({ userInfo: {}, projectId: "test-project" });
    await exchangeTokens("antigravity", "test-code", auth.redirectUri, auth.codeVerifier, auth.state);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body.get("redirect_uri")).toBe(hosted);
  });

  it("rejects a callback configuration change before contacting Google", async () => {
    vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", hosted);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeTokens("antigravity", "test-code", fallback, "test-verifier", "test-state"))
      .rejects.toThrow("callback URL changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-url",
    "http://ai.example.com/callback",
    "javascript:alert(1)",
    "https://user:password@ai.example.com/callback",
    "https://ai.example.com/other",
    "https://ai.example.com/callback?code=old",
    "https://ai.example.com/callback#fragment",
  ])("fails closed for invalid configuration: %s", async (configured) => {
    vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", configured);
    await expect(generateAuthData("antigravity", fallback)).rejects.toThrow("ANTIGRAVITY_REDIRECT_URI");
  });

  it.each(["http://localhost:8080/callback", "http://127.0.0.1:8080/callback", "http://[::1]:8080/callback"])(
    "allows explicit loopback overrides: %s", (configured) => {
      vi.stubEnv("ANTIGRAVITY_REDIRECT_URI", configured);
      expect(resolveAntigravityRedirectUri(fallback)).toBe(configured);
    }
  );

  it("rejects stale, missing, and cross-attempt callback states", () => {
    expect(matchesOAuthState("current-state", "current-state")).toBe(true);
    expect(matchesOAuthState("current-state", "previous-state")).toBe(false);
    expect(matchesOAuthState("current-state", null)).toBe(false);
    expect(matchesOAuthState(undefined, undefined)).toBe(false);
    expect(matchesOAuthState("", "")).toBe(false);
  });

  it("wires server redirect, callback state filtering, and deduplication into the modal", () => {
    const modal = readFileSync(new URL("../../src/shared/components/OAuthModal.js", import.meta.url), "utf8");
    expect(modal).toContain("redirectUri = data.redirectUri || redirectUri;");
    expect(modal).toContain("new URL(redirectUri).origin !== window.location.origin");
    expect(modal).toContain("!matchesOAuthState(authData.state, data.state)");
    expect(modal).toContain("!matchesOAuthState(authData.state, state)");
    const exchange = modal.slice(modal.indexOf("const exchangeTokens ="), modal.indexOf("const completeXaiManualCode ="));
    expect(exchange.indexOf("if (callbackProcessedRef.current) return;")).toBeLessThan(exchange.indexOf("await fetch("));
    expect(exchange.indexOf("callbackProcessedRef.current = true;")).toBeLessThan(exchange.indexOf("await fetch("));
    expect(modal).not.toContain('event.origin.includes("localhost")');
  });
});
