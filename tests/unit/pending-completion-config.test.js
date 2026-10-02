import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("pending completion timeout configuration", () => {
  it.each([
    [undefined, 3000],
    ["", 3000],
    ["invalid", 3000],
    ["0", 3000],
    ["-1", 3000],
    ["1500", 1500],
  ])("uses %s as %s milliseconds", async (value, expected) => {
    vi.stubEnv("PENDING_COMPLETION_FLUSH_MS", value);
    vi.resetModules();
    const { PENDING_COMPLETION_FLUSH_MS } = await import("../../open-sse/config/runtimeConfig.js");
    expect(PENDING_COMPLETION_FLUSH_MS).toBe(expected);
  });
});
