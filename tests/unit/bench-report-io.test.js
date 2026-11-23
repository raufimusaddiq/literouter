import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { capSamples, slimRun, writeReports, MAX_RAW_SAMPLES } from "../../scripts/bench/report-io.mjs";

const big = (n) => Array.from({ length: n }, (_, i) => ({ seq: i, totalMs: i, error: null }));

describe("bench report-io", () => {
  it("capSamples bounds big input, keeps first/last, does not mutate", () => {
    const src = big(50000);
    const out = capSamples(src, 200);
    expect(out).toHaveLength(200);
    expect(out[0].seq).toBe(0);
    expect(out.at(-1).seq).toBe(49999);
    expect(src).toHaveLength(50000);
  });
  it("capSamples passes small input through as a copy and tolerates non-arrays", () => {
    const src = big(3);
    const out = capSamples(src, 200);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(capSamples(undefined)).toEqual([]);
  });
  it("slimRun keeps the report and a bounded sample", () => {
    const s = slimRun({ report: { total: 90000 }, results: big(90000) });
    expect(s.report.total).toBe(90000);
    expect(s.sampleCount).toBe(90000);
    expect(s.samples.length).toBeLessThanOrEqual(MAX_RAW_SAMPLES);
  });
  it("writeReports writes md and json for a large synthetic result set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-io-"));
    const base = path.join(dir, "r-mock");
    const out = { sections: { c: slimRun({ report: { total: 400000 }, results: big(400000) }) } };
    const res = writeReports(base, ["# t", "body"], out, { quiet: true });
    expect(res.every((r) => r.ok)).toBe(true);
    expect(fs.readFileSync(`${base}.md`, "utf8")).toBe("# t\nbody");
    expect(fs.statSync(`${base}.json`).size).toBeLessThan(200 * 1024);
    expect(JSON.parse(fs.readFileSync(`${base}.json`, "utf8")).sections.c.sampleCount).toBe(400000);
  });
  it("a failing json write does not lose the md", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-io-"));
    const base = path.join(dir, "r-mock");
    const circular = {}; circular.self = circular;
    const res = writeReports(base, ["ok"], circular, { quiet: true });
    expect(res[0].ok).toBe(true);
    expect(res[1].ok).toBe(false);
    expect(fs.readFileSync(`${base}.md`, "utf8")).toBe("ok");
  });
});
