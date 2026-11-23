#!/usr/bin/env bun
import fs from "node:fs";
import { percentile } from "../bench/stats.mjs";

export const LATENCY_TOLERANCE = 1.05;
export const MAX_IMAGE_BYTES = 150_000_000;
export const IMAGE_ARCHES = ["amd64", "arm64"];
const METRICS = ["rssIdleMiB", "rssPostBurstMiB", "p50Ms", "p95Ms"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

export function evaluatePerf({ node, bun }) {
  const failures = [];
  for (const key of ["rssIdleMiB", "rssPostBurstMiB"]) {
    if (!isNum(node?.[key]) || !isNum(bun?.[key])) failures.push(`${key}: missing or non-positive value`);
    else if (!(bun[key] < node[key])) failures.push(`${key}: bun ${bun[key]} is not strictly lower than baseline ${node[key]}`);
  }
  for (const key of ["p50Ms", "p95Ms"]) {
    if (!isNum(node?.[key]) || !isNum(bun?.[key])) failures.push(`${key}: missing or non-positive value`);
    else if (bun[key] > node[key] * LATENCY_TOLERANCE) failures.push(`${key}: bun ${bun[key]} exceeds baseline ${node[key]} x ${LATENCY_TOLERANCE}`);
  }
  const sizes = bun?.imageBytes ?? {};
  for (const arch of IMAGE_ARCHES) {
    if (!isNum(sizes[arch])) failures.push(`imageBytes: bun ${arch} size is required`);
    else if (sizes[arch] > MAX_IMAGE_BYTES) failures.push(`imageBytes: bun ${arch} ${sizes[arch]} exceeds ${MAX_IMAGE_BYTES}`);
  }
  return { pass: failures.length === 0, failures };
}

export function medianMeasures(list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error("median needs at least one measure");
  const out = {};
  for (const key of METRICS) {
    const values = list.map((m) => m?.[key]);
    if (!values.every(isNum)) throw new Error(`median: ${key} missing or non-positive in an input`);
    out[key] = percentile(values, 50);
  }
  const imageBytes = {};
  for (const m of list) for (const arch of IMAGE_ARCHES) if (isNum(m?.imageBytes?.[arch])) imageBytes[arch] = m.imageBytes[arch];
  if (Object.keys(imageBytes).length > 0) out.imageBytes = imageBytes;
  return out;
}

const USAGE = "usage: bun scripts/cutover/perf-gate.mjs <node.json> <bun.json>\n       bun scripts/cutover/perf-gate.mjs --median <round.json>... > out.json";

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  try {
    if (argv[0] === "--median") {
      if (argv.length < 2) throw Object.assign(new Error(USAGE), { usage: true });
      console.log(JSON.stringify(medianMeasures(argv.slice(1).map(read)), null, 2));
      process.exit(0);
    }
    if (argv.length !== 2) throw Object.assign(new Error(USAGE), { usage: true });
    const { pass, failures } = evaluatePerf({ node: read(argv[0]), bun: read(argv[1]) });
    if (pass) console.log("perf gate: pass");
    else {
      console.error("perf gate: FAIL");
      for (const f of failures) console.error(`- ${f}`);
    }
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
