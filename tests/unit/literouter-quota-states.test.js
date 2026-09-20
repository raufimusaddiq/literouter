import { describe, expect, it } from "vitest";
import {
  isModelLockActive,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
  checkFallbackError,
  getQuotaCooldown,
} from "../../open-sse/services/accountFallback.js";

// PRD section 24: quota states must be explicit and the router must never loop
// indefinitely on quota or retry errors.

const MODEL = "test-model";
const LOCK_KEY = `modelLock_${MODEL}`;

describe("quota states", () => {
  it("available: no lock and no rate limit means eligible", () => {
    expect(isModelLockActive({}, MODEL)).toBe(false);
  });

  it("cooldown: an unexpired lock keeps the account out of rotation", () => {
    const update = buildModelLockUpdate(MODEL, 60_000);
    const conn = { ...update };
    expect(isModelLockActive(conn, MODEL)).toBe(true);
  });

  it("available again: an expired lock does not block the account", () => {
    const conn = { [LOCK_KEY]: new Date(Date.now() - 1000).toISOString() };
    expect(isModelLockActive(conn, MODEL)).toBe(false);
  });

  it("exhausted: earliest reset is reported for retry hints", () => {
    const conn = { [LOCK_KEY]: new Date(Date.now() + 30_000).toISOString() };
    const earliest = getEarliestModelLockUntil(conn);
    expect(earliest).toBeTruthy();
    expect(new Date(earliest).getTime()).toBeGreaterThan(Date.now());
  });

  it("error: unknown accounts stay eligible rather than being treated as exhausted", () => {
    // A connection with no lock fields and no status is eligible, not blocked.
    const conn = { testStatus: "unknown" };
    expect(isModelLockActive(conn, MODEL)).toBe(false);
  });
});

describe("retry bound", () => {
  it("rate limits trigger fallback with an exponential cooldown", () => {
    const first = checkFallbackError(429, "rate limit", 0);
    expect(first.shouldFallback).toBe(true);
    expect(first.cooldownMs).toBeGreaterThan(0);
  });

  it("cooldown grows then saturates instead of growing without bound", () => {
    const values = [0, 1, 2, 3, 4, 10, 50].map((level) => getQuotaCooldown(level));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1]).toBe(values[values.length - 2]);
  });

  it("client request errors do not cool down the account", () => {
    // 404 is intentionally treated as an account-scoped signal upstream (it can
    // mean a revoked or deleted credential), so it is excluded here.
    for (const status of [400, 422]) {
      expect(checkFallbackError(status, "bad request", 0).shouldFallback).toBe(false);
    }
  });

  it("documented account-scoped statuses cool the account down", () => {
    for (const status of [401, 402, 403, 404]) {
      expect(checkFallbackError(status, "denied", 0).shouldFallback).toBe(true);
    }
  });

  it("credential errors still fall back", () => {
    for (const status of [401, 402, 403]) {
      expect(checkFallbackError(status, "denied", 0).shouldFallback).toBe(true);
    }
  });
});
