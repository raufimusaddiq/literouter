import fs from "node:fs";
import path from "node:path";

const read = (dir) => {
  const file = path.join(dir, "upstream-requests.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

export function loadAllowlist(file = new URL("./runtime-header-allowlist.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const headerMap = (pairs, ignored) => {
  const out = {};
  for (const [k, v] of pairs) {
    const key = k.toLowerCase();
    if (ignored.has(key)) continue;
    out[key] = key in out ? `${out[key]}, ${v}` : v;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export function compareUpstream(expected, actual, allowlist = []) {
  const ignored = new Set(allowlist.map((e) => e.header.toLowerCase()));
  const problems = [];
  if (expected.length !== actual.length) problems.push(`request count: expected ${expected.length}, actual ${actual.length}`);
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    const e = expected[i];
    const a = actual[i];
    if (e.method !== a.method || e.path !== a.path) problems.push(`#${i} request line: expected ${e.method} ${e.path}, actual ${a.method} ${a.path}`);
    const eh = headerMap(e.headers, ignored);
    const ah = headerMap(a.headers, ignored);
    for (const k of new Set([...Object.keys(eh), ...Object.keys(ah)])) {
      if (eh[k] !== ah[k]) problems.push(`#${i} header ${k}: expected ${JSON.stringify(eh[k])}, actual ${JSON.stringify(ah[k])}`);
    }
    if (e.bodyBase64 !== a.bodyBase64) problems.push(`#${i} body differs (${Buffer.from(e.bodyBase64, "base64").length} vs ${Buffer.from(a.bodyBase64, "base64").length} bytes)`);
  }
  return problems;
}

if (import.meta.main) {
  const [expectedDir, actualDir] = process.argv.slice(2);
  if (!expectedDir || !actualDir) {
    console.error("usage: bun tests/parity/compare-upstream.mjs <expectedDir> <actualDir>");
    process.exit(2);
  }
  const problems = compareUpstream(read(expectedDir), read(actualDir), loadAllowlist());
  problems.forEach((p) => console.error(p));
  console.log(`${problems.length} upstream diffs`);
  process.exit(problems.length ? 1 : 0);
}
