import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";
import {
  validateGrokWeb,
  validatePerplexityWeb,
} from "@/lib/providers/webCookieValidators.js";

const originalFetch = global.fetch;

describe("grok-web validation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it.each([200, 400, 429])("status %d → valid", async (status) => {
    global.fetch = vi.fn().mockResolvedValue({ status });
    const result = await validateGrokWeb("test-token");
    expect(result).toEqual({ valid: true, error: null });
  });

  it.each([401, 403])("status %d → invalid SSO cookie error", async (status) => {
    global.fetch = vi.fn().mockResolvedValue({ status });
    const result = await validateGrokWeb("bad-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid SSO cookie");
  });

  it.each([
    ["sso=abc123", "sso=abc123"],
    ["abc123", "sso=abc123"],
  ])("%p → Cookie header %p", async (input, expectedCookie) => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb(input);
    expect(global.fetch.mock.calls[0][1].headers.Cookie).toBe(expectedCookie);
  });

  it("POSTs to the conversation endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("token");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://grok.com/rest/app-chat/conversations/new",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Cloudflare-bypass headers", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("token");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Origin).toBe("https://grok.com");
    expect(headers.Referer).toBe("https://grok.com/");
    expect(headers["User-Agent"]).toContain("Chrome");
    expect(headers["x-statsig-id"]).toBeTruthy();
    expect(headers["x-xai-request-id"]).toBeTruthy();
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  });
});

describe("perplexity-web validation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it("status 200 → valid", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    const result = await validatePerplexityWeb("test-token");
    expect(result).toEqual({ valid: true, error: null });
  });

  it.each([401, 403])("status %d → invalid session cookie error", async (status) => {
    global.fetch = vi.fn().mockResolvedValue({ status });
    const result = await validatePerplexityWeb("bad-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid session cookie");
  });

  it.each([
    ["__Secure-next-auth.session-token=xyz789", "__Secure-next-auth.session-token=xyz789"],
    ["xyz789", "__Secure-next-auth.session-token=xyz789"],
  ])("%p → Cookie header %p", async (input, expectedCookie) => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validatePerplexityWeb(input);
    expect(global.fetch.mock.calls[0][1].headers.Cookie).toBe(expectedCookie);
  });

  it("POSTs to perplexity_ask", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validatePerplexityWeb("token");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.perplexity.ai/rest/sse/perplexity_ask",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
