import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { vi } from "#test/vi";

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

const realVersions = Object.getOwnPropertyDescriptor(process, "versions");
const proxyOptions = { enabled: true, url: "http://127.0.0.1:9" };

function simulateNode() {
  Object.defineProperty(process, "versions", {
    configurable: true,
    value: { ...process.versions, bun: undefined },
  });
}

beforeEach(() => {
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  Object.defineProperty(process, "versions", realVersions);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("proxyAwareFetch on a non-Bun runtime", () => {
  it("throws before any network call when strictProxy is on", async () => {
    simulateNode();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(proxyAwareFetch("http://127.0.0.1:1/x", {}, { ...proxyOptions, strictProxy: true }))
      .rejects.toThrow(/requires the Bun runtime.*strictProxy=true/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per process and continues when strictProxy is off", async () => {
    simulateNode();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      await proxyAwareFetch("http://127.0.0.1:1/x", {}, proxyOptions).catch(() => {});
    }
    const guardWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("requires the Bun runtime"));
    expect(guardWarnings).toHaveLength(1);
  });

  it("does not engage the guard on Bun", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(proxyAwareFetch("http://127.0.0.1:1/x", {}, { ...proxyOptions, strictProxy: true }))
      .rejects.toThrow(/strictProxy=true/);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("requires the Bun runtime"))).toBe(false);
  });
});
