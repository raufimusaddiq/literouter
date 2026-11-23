import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";


const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

const { assertPublicUrl, assertPublicUrlResolved, fetchPublic } = await import("../../src/shared/utils/ssrfGuard.js");

describe("assertPublicUrl: literal hostname/IP bypasses from #3714", () => {
  it("blocks a trailing-dot FQDN the same as the bare hostname", () => {
    expect(() => assertPublicUrl("http://localhost/")).toThrow();
    expect(() => assertPublicUrl("http://localhost./")).toThrow();
    expect(() => assertPublicUrl("http://LOCALHOST./")).toThrow();
  });

  it("blocks IPv4-mapped IPv6 loopback regardless of which textual form the URL parser picks", () => {
    expect(() => assertPublicUrl("http://[::ffff:127.0.0.1]/")).toThrow();
    expect(() => assertPublicUrl("http://[::ffff:7f00:1]/")).toThrow();
    expect(() => assertPublicUrl("http://[0000::ffff:127.0.0.1]/")).toThrow();
  });

  it("blocks IPv4-mapped IPv6 cloud metadata address (169.254.169.254)", () => {
    expect(() => assertPublicUrl("http://[::ffff:169.254.169.254]/")).toThrow();
    expect(() => assertPublicUrl("http://[::ffff:a9fe:a9fe]/")).toThrow();
  });

  it("blocks other loopback/private/link-local/ULA IPv6 forms", () => {
    for (const url of [
      "http://[::1]/",
      "http://[::127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
      "http://[64:ff9b::127.0.0.1]/",
    ]) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
  });

  it("blocks alternate IPv4 literal encodings (already normalized by the URL parser)", () => {
    for (const url of ["http://127.1/", "http://0177.0.0.1/", "http://2130706433/", "http://0x7f.0.0.1/"]) {
      expect(() => assertPublicUrl(url), url).toThrow();
    }
  });

  it("still allows public hosts, including public IPv6", () => {
    expect(() => assertPublicUrl("https://api.openai.com/v1/models")).not.toThrow();
    expect(() => assertPublicUrl("http://8.8.8.8/")).not.toThrow();
    expect(() => assertPublicUrl("https://[2001:4860:4860::8888]/")).not.toThrow();
  });
});

describe("assertPublicUrlResolved: DNS-resolving hostname bypass from #3714", () => {
  beforeEach(() => lookupMock.mockReset());

  it("blocks a hostname that resolves to a loopback address (nip.io-style wildcard DNS)", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicUrlResolved("http://127.0.0.1.nip.io/")).rejects.toThrow();
  });

  it("blocks a hostname that resolves to a private range even if one of several addresses is public", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.5", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    await expect(assertPublicUrlResolved("http://multi-a-record.example.test/")).rejects.toThrow();
  });

  it("blocks a hostname that resolves to a blocked IPv6 address", async () => {
    lookupMock.mockResolvedValue([{ address: "::1", family: 6 }]);
    await expect(assertPublicUrlResolved("http://evil.example.test/")).rejects.toThrow();
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicUrlResolved("https://example.com/")).resolves.toBeUndefined();
  });


  it("skips DNS lookup entirely for literal IP hosts (already covered by the sync check)", async () => {
    await expect(assertPublicUrlResolved("http://127.0.0.1/")).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("fetchPublic: redirect-target re-validation from #3714", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
  });

  it("blocks a redirect from a validated public URL to an internal target", async () => {
    global.fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1:9999/admin" },
    }));

    await expect(fetchPublic("https://public.example.test/redirect")).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect chain of public URLs, re-validating each hop", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://hop2.example.test/" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchPublic("https://hop1.example.test/");
    expect(await res.text()).toBe("ok");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe("https://hop2.example.test/");
  });

  it("bounds the redirect chain instead of looping forever", async () => {
    global.fetch = vi.fn(async (url) => new Response(null, {
      status: 302,
      headers: { Location: url === "https://loop.example.test/a" ? "https://loop.example.test/b" : "https://loop.example.test/a" },
    }));

    await expect(fetchPublic("https://loop.example.test/a", {}, { maxRedirects: 3 })).rejects.toThrow(/too many redirects/i);
  });

  it("rejects the initial URL before ever calling fetch", async () => {
    global.fetch = vi.fn();
    await expect(fetchPublic("http://127.0.0.1/steal")).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
