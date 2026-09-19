import { describe, it, expect, vi, afterEach } from "vitest";
import { __decodeSelfCheck, redisEnabled, redisGet } from "../../src/lib/redis.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("redis client", () => {
  it("decodes pipelined RESP replies in order", () => {
    expect(__decodeSelfCheck()).toBe(true);
  });

  it("is disabled and returns null when REDIS_URL is unset", async () => {
    delete process.env.REDIS_URL;
    expect(redisEnabled()).toBe(false);
    expect(await redisGet("anything")).toBeNull();
  });

  it("fails open when the server is unreachable", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    process.env.REDIS_TIMEOUT_MS = "50";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(redisEnabled()).toBe(true);
    expect(await redisGet("anything")).toBeNull();
    warn.mockRestore();
  });
});
