import { describe, it, expect } from "bun:test";
import { evaluatePerf } from "../../scripts/cutover/perf-gate.mjs";

const base = (over = {}) => ({
  rssIdleMiB: 100,
  rssPostBurstMiB: 150,
  p50Ms: 10,
  p95Ms: 20.0,
  ...over,
});
const bunOk = (over = {}) => base({ rssIdleMiB: 50, rssPostBurstMiB: 80, imageBytes: { amd64: 100_000_000, arm64: 100_000_000 }, ...over });

describe("evaluatePerf", () => {
  it("passes when bun is lower on RSS and equal on latency", () => {
    const r = evaluatePerf({ node: base(), bun: bunOk() });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("fails when idle RSS is equal", () => {
    const r = evaluatePerf({ node: base(), bun: bunOk({ rssIdleMiB: 100 }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("rssIdleMiB"))).toBe(true);
  });

  it("fails when post-burst RSS is higher", () => {
    const r = evaluatePerf({ node: base(), bun: bunOk({ rssPostBurstMiB: 151 }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("rssPostBurstMiB"))).toBe(true);
  });

  it("p95 within 5% passes, 6% fails", () => {
    expect(evaluatePerf({ node: base(), bun: bunOk({ p95Ms: 20.9 }) }).pass).toBe(true);
    const r = evaluatePerf({ node: base(), bun: bunOk({ p95Ms: 21.2 }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("p95Ms"))).toBe(true);
    expect(r.failures.some((f) => f.includes("p50Ms"))).toBe(false);
  });

  it("fails when only amd64 image size is given", () => {
    const r = evaluatePerf({ node: base(), bun: bunOk({ imageBytes: { amd64: 100_000_000 } }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("imageBytes") && f.includes("arm64"))).toBe(true);
  });

  it("fails at 150000001 bytes, passes at 150000000", () => {
    expect(evaluatePerf({ node: base(), bun: bunOk({ imageBytes: { amd64: 150_000_000, arm64: 150_000_000 } }) }).pass).toBe(true);
    const r = evaluatePerf({ node: base(), bun: bunOk({ imageBytes: { amd64: 150_000_001, arm64: 150_000_000 } }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("imageBytes") && f.includes("amd64"))).toBe(true);
  });
});
