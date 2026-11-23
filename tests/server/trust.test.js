import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isLoopbackAddress, deriveClientIp, buildRequestContext } from "../../src/server/trust.js";
import { PROXY_MARKER_HEADERS } from "../../src/lib/auth/proxyMarkers.js";

const headers = (init = {}) => new Headers(init);

describe("isLoopbackAddress", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "[::1]", "::FFFF:127.0.0.1"])(
    "treats %p as loopback",
    (addr) => {
      expect(isLoopbackAddress(addr)).toBe(true);
    }
  );

  it.each(["127.0.0.2", "::ffff:203.0.113.9", "", "10.0.0.1", "2001:db8::1", "[2001:db8::1]"])(
    "refuses %p",
    (addr) => {
      expect(isLoopbackAddress(addr)).toBe(false);
    }
  );

  it("refuses a missing address", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
  });
});

describe("deriveClientIp", () => {
  it("takes the rightmost X-Forwarded-For hop from a loopback proxy", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(deriveClientIp("127.0.0.1", h)).toBe("203.0.113.9");
  });

  it("prefers X-Real-IP over X-Forwarded-For", () => {
    const h = headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(deriveClientIp("::1", h)).toBe("198.51.100.4");
  });

  it("ignores forwarding headers from a non-loopback peer", () => {
    const h = headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(deriveClientIp("203.0.113.50", h)).toBe("203.0.113.50");
  });

  it("counts an IPv4-mapped loopback peer as a loopback proxy", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(deriveClientIp("::ffff:127.0.0.1", h)).toBe("203.0.113.9");
  });

  it("keeps the peer address when a loopback peer sent no forwarding headers", () => {
    expect(deriveClientIp("127.0.0.1", headers())).toBe("127.0.0.1");
  });

  it("skips empty X-Forwarded-For hops", () => {
    expect(deriveClientIp("127.0.0.1", headers({ "x-forwarded-for": "203.0.113.9, " }))).toBe("203.0.113.9");
  });
});

describe("buildRequestContext", () => {
  beforeEach(() => {
    delete process.env.TRUST_LOOPBACK_AS_LOCAL;
  });

  afterEach(() => {
    delete process.env.TRUST_LOOPBACK_AS_LOCAL;
  });

  it("marks a direct loopback peer as local", () => {
    expect(buildRequestContext("127.0.0.1", headers({ host: "localhost:20128" }))).toEqual({
      peerIp: "127.0.0.1",
      clientIp: "127.0.0.1",
      isLocal: true,
    });
  });

  it.each(["::1", "::ffff:127.0.0.1"])("marks %p as local", (peer) => {
    expect(buildRequestContext(peer, headers()).isLocal).toBe(true);
  });

  it("treats loopback with X-Forwarded-For as remote and keys on the proxied client", () => {
    const ctx = buildRequestContext("127.0.0.1", headers({ "x-forwarded-for": "203.0.113.9" }));
    expect(ctx).toEqual({ peerIp: "127.0.0.1", clientIp: "203.0.113.9", isLocal: false });
  });

  it.each(PROXY_MARKER_HEADERS)("treats loopback carrying %p as remote", (marker) => {
    expect(buildRequestContext("127.0.0.1", headers({ [marker]: "203.0.113.9" })).isLocal).toBe(false);
  });

  it("covers all eight proxy marker headers", () => {
    expect(PROXY_MARKER_HEADERS).toHaveLength(8);
  });

  it("treats every loopback peer as a proxy hop when TRUST_LOOPBACK_AS_LOCAL=false", () => {
    process.env.TRUST_LOOPBACK_AS_LOCAL = "false";
    expect(buildRequestContext("127.0.0.1", headers()).isLocal).toBe(false);
  });

  it("treats a loopback peer with a foreign Origin as remote", () => {
    expect(buildRequestContext("127.0.0.1", headers({ origin: "https://evil.example" })).isLocal).toBe(false);
  });

  it("treats a loopback peer with an unparseable Origin as remote", () => {
    expect(buildRequestContext("127.0.0.1", headers({ origin: "null" })).isLocal).toBe(false);
  });

  it("accepts a loopback Origin", () => {
    expect(buildRequestContext("127.0.0.1", headers({ origin: "http://localhost:20128" })).isLocal).toBe(true);
    expect(buildRequestContext("127.0.0.1", headers({ origin: "http://[::1]:20128" })).isLocal).toBe(true);
  });

  it("never treats a non-loopback peer as local, even with a loopback Host", () => {
    const ctx = buildRequestContext("203.0.113.9", headers({ host: "localhost" }));
    expect(ctx).toEqual({ peerIp: "203.0.113.9", clientIp: "203.0.113.9", isLocal: false });
  });

  it.each(["127.0.0.2", "::ffff:203.0.113.9"])("never treats %p as local", (peer) => {
    expect(buildRequestContext(peer, headers()).isLocal).toBe(false);
  });
});
