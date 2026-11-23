#!/usr/bin/env bun
import fs from "node:fs";

export const LATENCY_TOLERANCE = 1.05;
export const MAX_IMAGE_BYTES = 150_000_000;
export const IMAGE_ARCHES = ["amd64", "arm64"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function evaluatePerf({ node, bun }) {
  const failures = [];
  for (const key of ["rssIdleMiB", "rssPostBurstMiB"]) {
    if (!isNum(node?.[key]) || !isNum(bun?.[key])) failures.push(`${key}: missing or non-numeric value`);
    else if (!(bun[key] < node[key])) failures.push(`${key}: bun ${bun[key]} is not strictly lower than baseline ${node[key]}`);
  }
  for (const key of ["p50Ms", "p95Ms"]) {
    if (!isNum(node?.[key]) || !isNum(bun?.[key])) failures.push(`${key}: missing or non-numeric value`);
    else if (bun[key] > node[key] * LATENCY_TOLERANCE) failures.push(`${key}: bun ${bun[key]} exceeds baseline ${node[key]} x ${LATENCY_TOLERANCE}`);
  }
  const sizes = bun?.imageBytes ?? {};
  for (const arch of IMAGE_ARCHES) {
    if (!isNum(sizes[arch])) failures.push(`imageBytes: bun ${arch} size is required`);
    else if (sizes[arch] > MAX_IMAGE_BYTES) failures.push(`imageBytes: bun ${arch} ${sizes[arch]} exceeds ${MAX_IMAGE_BYTES}`);
  }
  return { pass: failures.length === 0, failures };
}

if (import.meta.main) {
  const [nodePath, bunPath] = process.argv.slice(2);
  if (!nodePath || !bunPath) {
    console.error("usage: bun scripts/cutover/perf-gate.mjs <node.json> <bun.json>");
    process.exit(2);
  }
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const { pass, failures } = evaluatePerf({ node: read(nodePath), bun: read(bunPath) });
  if (pass) console.log("perf gate: pass");
  else {
    console.error("perf gate: FAIL");
    for (const f of failures) console.error(`- ${f}`);
  }
  process.exit(pass ? 0 : 1);
}
