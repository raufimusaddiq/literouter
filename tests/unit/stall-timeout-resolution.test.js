// DeepSeek Flash lanes hang silently after ~2 chunks; they get a short stall budget
// while every other model keeps the long default.
import { describe, it, expect } from "vitest";
import { resolveStallTimeoutMs } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { STREAM_STALL_TIMEOUT_MS, STREAM_STALL_TIMEOUT_FLASH_MS } from "../../open-sse/config/runtimeConfig.js";

describe("resolveStallTimeoutMs", () => {
  it("uses the short budget for DeepSeek Flash on opencode-go and kenari", () => {
    expect(resolveStallTimeoutMs("opencode-go", "deepseek-v4.1-flash")).toBe(STREAM_STALL_TIMEOUT_FLASH_MS);
    expect(resolveStallTimeoutMs("kenari", "deepseek-v4-1-flash")).toBe(STREAM_STALL_TIMEOUT_FLASH_MS);
  });
  it("keeps the long budget for other models", () => {
    expect(resolveStallTimeoutMs("kenari", "deepseek-v4-pro")).toBe(STREAM_STALL_TIMEOUT_MS);
    expect(resolveStallTimeoutMs("codex", "gpt-6.1-sol")).toBe(STREAM_STALL_TIMEOUT_MS);
    expect(resolveStallTimeoutMs("claude", undefined)).toBe(STREAM_STALL_TIMEOUT_MS);
  });
  it("short budget is shorter than the default", () => {
    expect(STREAM_STALL_TIMEOUT_FLASH_MS).toBeLessThan(STREAM_STALL_TIMEOUT_MS);
  });
});
