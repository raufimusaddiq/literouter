import { describe, it, expect } from "bun:test";
import { beginAttempt, recordSuccess } from "@/lib/auth/loginLimiter.js";

describe("beginAttempt", () => {
  it("locks after the budget even when every attempt starts before any compare finishes", () => {
    const ip = "203.0.113.9";
    const results = Array.from({ length: 8 }, () => beginAttempt(ip));
    expect(results.filter((r) => !r.locked)).toHaveLength(5);
    expect(results.slice(5).every((r) => r.locked && r.retryAfter > 0)).toBe(true);
    recordSuccess(ip);
  });

  it("recordSuccess clears the window", () => {
    const ip = "203.0.113.10";
    beginAttempt(ip);
    recordSuccess(ip);
    expect(beginAttempt(ip).remainingBeforeLock).toBe(4);
  });
});
