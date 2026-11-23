import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";
import { useTempDataDir } from "#test/tempDataDir";
import crypto from "node:crypto";

const mocks = vi.hoisted(() => ({
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("@/lib/db/index.js", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(async () => false) }));

const { generateApiKeyWithMachine, parseApiKey } = await import("@/shared/utils/apiKey.js");
const { safeEqual } = await import("@/shared/utils/safeEqual.js");
const throttle = await import("@/lib/auth/apiKeyThrottle.js");
const { isWeakApiKeySecret } = await import("@/lib/auth/apiKeySecretWarning.js");
const { guard, __test__ } = await import("../../src/server/guard.js");
const { setRequestContext } = await import("../../src/server/context.js");
const { buildRequestContext } = await import("../../src/server/trust.js");
const req = (pathname, headers = {}, peerIp = null) => {
  const r = {
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    url: `http://localhost${pathname}`,
    method: "GET",
  };
  if (peerIp !== null) setRequestContext(r, buildRequestContext(peerIp, r.headers));
  return r;
};
const loop = (pathname, headers = {}) => req(pathname, headers, "127.0.0.1");

describe("key format", () => {
  it("generates 192-bit keys without machineId and parses them", () => {
    const { key } = generateApiKeyWithMachine("abcdef0123456789");
    expect(key).toMatch(/^sk-[A-Za-z0-9_-]{32}$/);
    expect(key).not.toContain("abcdef0123456789");
    expect(generateApiKeyWithMachine("x").key).not.toBe(key);
    expect(parseApiKey(key)).toMatchObject({ isNewFormat: true, isLegacy: false });
  });
  it("still recognises legacy formats", () => {
    expect(parseApiKey("sk-abcd1234")).toMatchObject({ isLegacy: true, isNewFormat: false });
    const crc = crypto.createHmac("sha256", process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret")
      .update("machine1234567890" + "abc123").digest("hex").slice(0, 8);
    expect(parseApiKey(`sk-machine1234567890-abc123-${crc}`)).toMatchObject({ isLegacy: true, isNewFormat: true });
    expect(parseApiKey("sk-machine1234567890-abc123-deadbeef")).toBeNull();
  });
  it("safeEqual compares strings", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
    expect(safeEqual(undefined, "x")).toBe(false);
  });
  it("flags weak API_KEY_SECRET", () => {
    expect(isWeakApiKeySecret("")).toBe(true);
    expect(isWeakApiKeySecret(undefined)).toBe(true);
    expect(isWeakApiKeySecret("endpoint-proxy-api-key-secret")).toBe(true);
    expect(isWeakApiKeySecret("long-random-value")).toBe(false);
  });
});

describe("api key repo: legacy keys keep validating", () => {
  useTempDataDir("key-hard-");
  it("validates new and legacy keys, rejects unknown", async () => {
    vi.resetModules();
    const repo = await import("@/lib/db/repos/apiKeysRepo.js");
    const created = await repo.createApiKey("n", "machine-1");
    expect(created.key).toMatch(/^sk-[A-Za-z0-9_-]{32}$/);
    expect(await repo.validateApiKey(created.key)).toBe(true);
    expect(await repo.validateApiKey(created.key + "x")).toBe(false);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES('l1','sk-legacy-abcdef-12345678','old','m',1,'2020')`);
    await repo.updateApiKey("l1", {});
    expect(await repo.validateApiKey("sk-legacy-abcdef-12345678")).toBe(true);
  });
});

describe("failed-auth throttle", () => {
  beforeEach(() => throttle.resetApiKeyThrottle());
  it("blocks after the threshold and releases after the window", () => {
    const { MAX_FAILS, BLOCK_MS } = throttle.__limits;
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILS - 1; i++) throttle.recordApiKeyFailure("1.1.1.1", t0);
    expect(throttle.checkApiKeyThrottle("1.1.1.1", t0).blocked).toBe(false);
    throttle.recordApiKeyFailure("1.1.1.1", t0);
    const gate = throttle.checkApiKeyThrottle("1.1.1.1", t0 + 1000);
    expect(gate.blocked).toBe(true);
    expect(gate.retryAfter).toBeGreaterThan(0);
    expect(throttle.checkApiKeyThrottle("2.2.2.2", t0).blocked).toBe(false);
    expect(throttle.checkApiKeyThrottle("1.1.1.1", t0 + BLOCK_MS + 1).blocked).toBe(false);
  });
  it("failures outside the window do not accumulate", () => {
    const { MAX_FAILS, WINDOW_MS } = throttle.__limits;
    for (let i = 0; i < MAX_FAILS - 1; i++) throttle.recordApiKeyFailure("3.3.3.3", 0);
    throttle.recordApiKeyFailure("3.3.3.3", WINDOW_MS + 1);
    expect(throttle.checkApiKeyThrottle("3.3.3.3", WINDOW_MS + 2).blocked).toBe(false);
  });
  it("stays bounded", () => {
    const { MAX_ENTRIES } = throttle.__limits;
    for (let i = 0; i < MAX_ENTRIES + 500; i++) throttle.recordApiKeyFailure(`ip-${i}`, 5);
    expect(throttle.throttleSize()).toBeLessThanOrEqual(MAX_ENTRIES);
  });
  it("proxy returns 429 + Retry-After and counts only presented bad keys", async () => {
    mocks.validateApiKey.mockResolvedValue(false);
    const remote = (h = {}) => req("/v1/models", h, "9.9.9.9");
    for (let i = 0; i < throttle.__limits.MAX_FAILS - 1; i++) {
      expect((await guard(remote({ authorization: "Bearer sk-bad" }))).status).toBe(401);
    }
    const blocked = await guard(remote({ authorization: "Bearer sk-bad" }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const keyless = () => req("/v1/models", {}, "8.8.8.8");
    for (let i = 0; i < 30; i++) await guard(keyless());
    expect((await guard(keyless())).status).toBe(401);
  });
  it("blocked IP: valid key and CLI token still pass; bad/absent key gets 429", async () => {
    const remote = (h = {}) => req("/v1/models", h, "7.7.7.7");
    for (let i = 0; i < throttle.__limits.MAX_FAILS; i++) throttle.recordApiKeyFailure("7.7.7.7");
    expect(throttle.checkApiKeyThrottle("7.7.7.7").blocked).toBe(true);
    mocks.validateApiKey.mockImplementation(async (k) => k === "sk-good");
    expect(await guard(remote({ authorization: "Bearer sk-good" }))).toBeNull();
    expect(await guard(remote({ "x-9r-cli-token": "cli-token" }))).toBeNull();
    const bad = await guard(remote({ authorization: "Bearer sk-bad" }));
    expect(bad.status).toBe(429);
    expect(Number(bad.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await guard(remote())).status).toBe(429);
  });
  it("unknown peer IP skips the throttle (no shared bucket)", async () => {
    mocks.validateApiKey.mockResolvedValue(false);
    const anon = () => req("/v1/models", { authorization: "Bearer sk-bad" });
    for (let i = 0; i < throttle.__limits.MAX_FAILS + 5; i++) expect((await guard(anon())).status).toBe(401);
    expect(throttle.throttleSize()).toBe(0);
  });
});

describe("loopback classification", () => {
  beforeEach(() => { delete process.env.TRUST_LOOPBACK_AS_LOCAL; });
  afterEach(() => { delete process.env.TRUST_LOOPBACK_AS_LOCAL; });
  it("bare loopback is local", () => {
    expect(__test__.isLocalRequest(loop("/v1/models"))).toBe(true);
  });
  it("Caddy and CDN headers are remote", () => {
    for (const h of [{ "x-forwarded-proto": "https" }, { "x-forwarded-host": "ai.musaddiqr.com" },
      { via: "1.1 caddy" }, { forwarded: "for=1.2.3.4" },
      { "cf-connecting-ip": "1.2.3.4" }, { "true-client-ip": "1.2.3.4" }, { "x-real-ip": "1.2.3.4" }]) {
      expect(__test__.isLocalRequest(loop("/v1/models", h))).toBe(false);
    }
  });
  it("TRUST_LOOPBACK_AS_LOCAL=false makes loopback remote", () => {
    process.env.TRUST_LOOPBACK_AS_LOCAL = "false";
    expect(__test__.isLocalRequest(loop("/v1/models"))).toBe(false);
  });
});

describe("Bun server marker list", () => {
  it("trust.js decides locality from every header in src/lib/auth/proxyMarkers.js", async () => {
    const { PROXY_MARKER_HEADERS } = await import("@/lib/auth/proxyMarkers.js");
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/server/trust.js"), "utf8");
    expect(src).toContain("hasProxyMarker");
    for (const h of PROXY_MARKER_HEADERS) {
      expect(buildRequestContext("127.0.0.1", new Headers({ [h]: "1.2.3.4" })).isLocal).toBe(false);
    }
    expect(buildRequestContext("127.0.0.1", new Headers()).isLocal).toBe(true);
  });

  it("the strip list in src/server/index.js drops the retired peer headers and forwarded-for", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/server/index.js"), "utf8");
    const list = /const STRIPPED_HEADERS = \[([^\]]*)\]/.exec(src);
    expect(list).not.toBeNull();
    for (const h of ["x-9r-real-ip", "x-9r-peer-token", "x-9r-via-proxy", "x-forwarded-for"]) {
      expect(list[1]).toContain(`"${h}"`);
    }
  });
});
