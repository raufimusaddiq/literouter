// Login lockout must count attempts reserved BEFORE the bcrypt compare, so a
// burst of parallel guesses cannot all read the same pre-lockout count.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let limiter;

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

beforeEach(async () => {
  vi.resetModules();
  limiter = await import("../../src/lib/auth/loginLimiter.js");
  delete process.env.TRUST_PROXY;
  delete process.env.NINEROUTER_PEER_TOKEN;
});

afterEach(() => {
  delete process.env.TRUST_PROXY;
  delete process.env.NINEROUTER_PEER_TOKEN;
});

describe("login limiter reservations", () => {
  it("locks a burst of in-flight attempts that would each have passed checkLock", () => {
    const ip = "192.0.2.7";
    const outcomes = [];
    for (let i = 0; i < 10; i++) outcomes.push(limiter.beginAttempt(ip));

    expect(limiter.checkLock(ip).locked).toBe(true);
    expect(outcomes.filter((o) => o.locked).length).toBeGreaterThan(0);
    // Only the first MAX_FAILS_BEFORE_LOCK reservations may reach the compare.
    expect(outcomes.findIndex((o) => o.locked)).toBe(5);
  });

  it("resets the window on success and reports remaining attempts on failure", () => {
    const ip = "192.0.2.8";
    expect(limiter.beginAttempt(ip).remainingBeforeLock).toBe(4);
    limiter.recordSuccess(ip);
    expect(limiter.checkLock(ip).locked).toBe(false);
    expect(limiter.beginAttempt(ip).remainingBeforeLock).toBe(4);
  });
});

describe("login limiter client IP", () => {
  it("keys on the wrapper-stamped peer IP", () => {
    process.env.NINEROUTER_PEER_TOKEN = "tok";
    const ip = limiter.getClientIp(request({ "x-9r-real-ip": "203.0.113.6", "x-9r-peer-token": "tok" }));
    expect(ip).toBe("203.0.113.6");
  });

  it("buckets unstamped spoofed peer IPs together", () => {
    const first = limiter.getClientIp(request({ "x-9r-real-ip": "1.1.1.1" }));
    const second = limiter.getClientIp(request({ "x-9r-real-ip": "2.2.2.2" }));
    expect(first).toBe("unknown");
    expect(second).toBe("unknown");
  });
});
