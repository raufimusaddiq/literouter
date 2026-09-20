import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_POOL_SIZE;
  vi.resetModules();
});

describe("Redis command pool", () => {
  it("creates multiple independent command lanes without connecting eagerly", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.REDIS_POOL_SIZE = "4";

    const redis = await import("@/lib/redis.js");

    expect(redis.redisPoolSize()).toBe(4);
    expect(redis.__ensureRedisLanes()).toBe(4);
    expect(redis.__redisState.lanes).toHaveLength(4);
    expect(redis.__redisState.lanes.every((lane) => lane.conn === null)).toBe(true);
    redis.closeRedisPool();
  });

  it("clamps an excessive pool size", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.REDIS_POOL_SIZE = "99";

    const redis = await import("@/lib/redis.js");
    expect(redis.redisPoolSize()).toBe(16);
    expect(redis.__ensureRedisLanes()).toBe(16);
    redis.closeRedisPool();
  });
});
