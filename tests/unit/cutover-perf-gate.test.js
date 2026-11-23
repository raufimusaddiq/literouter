import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluatePerf, medianMeasures } from "../../scripts/cutover/perf-gate.mjs";
import { parseVmRssMiB } from "../../scripts/cutover/measure.mjs";

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

describe("evaluatePerf fails closed", () => {
  it("fails on a missing or NaN field", () => {
    const missing = evaluatePerf({ node: base(), bun: bunOk({ rssIdleMiB: undefined }) });
    expect(missing.pass).toBe(false);
    expect(missing.failures.some((f) => f.includes("rssIdleMiB"))).toBe(true);
    const nan = evaluatePerf({ node: base(), bun: bunOk({ p95Ms: NaN }) });
    expect(nan.pass).toBe(false);
    expect(nan.failures.some((f) => f.includes("p95Ms"))).toBe(true);
    expect(evaluatePerf({ node: base({ p50Ms: undefined }), bun: bunOk() }).pass).toBe(false);
  });

  it("fails on zero or negative values", () => {
    expect(evaluatePerf({ node: base(), bun: bunOk({ rssIdleMiB: 0 }) }).pass).toBe(false);
    expect(evaluatePerf({ node: base(), bun: bunOk({ p50Ms: -1 }) }).pass).toBe(false);
  });

  it("fails when p50 is over the limit", () => {
    const r = evaluatePerf({ node: base(), bun: bunOk({ p50Ms: 10.6 }) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes("p50Ms"))).toBe(true);
    expect(evaluatePerf({ node: base(), bun: bunOk({ p50Ms: 10.5 }) }).pass).toBe(true);
  });
});

describe("medianMeasures", () => {
  it("takes the per-metric median and merges imageBytes", () => {
    const rounds = [
      { rssIdleMiB: 60, rssPostBurstMiB: 90, p50Ms: 5, p95Ms: 12 },
      { rssIdleMiB: 50, rssPostBurstMiB: 80, p50Ms: 7, p95Ms: 10, imageBytes: { amd64: 1, arm64: 2 } },
      { rssIdleMiB: 70, rssPostBurstMiB: 85, p50Ms: 6, p95Ms: 11 },
    ];
    expect(medianMeasures(rounds)).toEqual({
      rssIdleMiB: 60, rssPostBurstMiB: 85, p50Ms: 6, p95Ms: 11, imageBytes: { amd64: 1, arm64: 2 },
    });
  });

  it("omits imageBytes when no input has it and rejects bad input", () => {
    expect("imageBytes" in medianMeasures([base()])).toBe(false);
    expect(() => medianMeasures([])).toThrow();
    expect(() => medianMeasures([base(), base({ p50Ms: NaN })])).toThrow(/p50Ms/);
  });
});

describe("parseVmRssMiB", () => {
  it("converts VmRSS kB to MiB", () => {
    expect(parseVmRssMiB("Name:\tbun\nVmRSS:\t   2048 kB\nThreads:\t4\n")).toBe(2);
  });

  it("throws when VmRSS is absent", () => {
    expect(() => parseVmRssMiB("Name:\tbun\n")).toThrow(/VmRSS/);
  });
});

describe("perf-gate CLI exit codes", () => {
  const script = resolve(__dirname, "../../scripts/cutover/perf-gate.mjs");
  const dir = mkdtempSync(join(tmpdir(), "perf-gate-"));
  const write = (name, obj) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const run = (...args) => Bun.spawnSync([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe" });

  it("exits 0 on pass, 1 on failure, 2 on usage error", () => {
    const node = write("node.json", base());
    const good = write("good.json", bunOk());
    const bad = write("bad.json", bunOk({ rssIdleMiB: 100 }));
    expect(run(node, good).exitCode).toBe(0);
    const failed = run(node, bad);
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.toString()).toContain("rssIdleMiB");
    expect(run(node).exitCode).toBe(2);
    expect(run().exitCode).toBe(2);
    expect(run(node, join(dir, "missing.json")).exitCode).toBe(2);
  });

  it("--median prints the median JSON and exits 2 without inputs", () => {
    const a = write("a.json", { rssIdleMiB: 1, rssPostBurstMiB: 2, p50Ms: 3, p95Ms: 4 });
    const b = write("b.json", { rssIdleMiB: 3, rssPostBurstMiB: 4, p50Ms: 5, p95Ms: 6 });
    const c = write("c.json", { rssIdleMiB: 2, rssPostBurstMiB: 3, p50Ms: 4, p95Ms: 5 });
    const r = run("--median", a, b, c);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({ rssIdleMiB: 2, rssPostBurstMiB: 3, p50Ms: 4, p95Ms: 5 });
    expect(run("--median").exitCode).toBe(2);
  });
});
