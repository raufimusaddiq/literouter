import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateKnownDiffs } from "./compare.mjs";

export const UPSTREAM_LOG = "upstream-requests.jsonl";
export const UPSTREAM_INDEX = "upstream-fixtures.jsonl";

const readJsonl = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (b64) => crypto.createHash("sha256").update(Buffer.from(b64 ?? "", "base64")).digest("hex");

export function loadAllowlist(file = new URL("./runtime-header-allowlist.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadKnownUpstreamDiffs(file = new URL("./known-upstream-diffs.json", import.meta.url)) {
  const known = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = validateKnownDiffs(known).map((p) => p.replace("known-diffs", "known-upstream-diffs"));
  if (problems.length) throw new Error(problems.join("\n"));
  return known;
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

export function upstreamDiffs(expected, actual, allowlist = []) {
  const ignored = new Set(allowlist.map((e) => e.header.toLowerCase()));
  const diffs = [];
  if (expected.length !== actual.length) {
    diffs.push({ path: "count", expected: expected.length, actual: actual.length, message: `request count: expected ${expected.length}, actual ${actual.length}` });
  }
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    const e = expected[i];
    const a = actual[i];
    if (e.method !== a.method || e.path !== a.path) {
      diffs.push({ path: `[${i}].request`, expected: `${e.method} ${e.path}`, actual: `${a.method} ${a.path}`, message: `#${i} request line: expected ${e.method} ${e.path}, actual ${a.method} ${a.path}` });
    }
    const eh = headerMap(e.headers, ignored);
    const ah = headerMap(a.headers, ignored);
    for (const k of new Set([...Object.keys(eh), ...Object.keys(ah)])) {
      if (eh[k] !== ah[k]) diffs.push({ path: `[${i}].header.${k}`, expected: eh[k], actual: ah[k], message: `#${i} header ${k}: expected ${JSON.stringify(eh[k])}, actual ${JSON.stringify(ah[k])}` });
    }
    if (e.bodyBase64 !== a.bodyBase64) {
      diffs.push({ path: `[${i}].body`, expected: sha(e.bodyBase64), actual: sha(a.bodyBase64), message: `#${i} body differs (${Buffer.from(e.bodyBase64, "base64").length} vs ${Buffer.from(a.bodyBase64, "base64").length} bytes)` });
    }
  }
  return diffs;
}

export function compareUpstream(expected, actual, allowlist = []) {
  return upstreamDiffs(expected, actual, allowlist).map((d) => d.message);
}

export function requestsByFixture(dir) {
  const all = readJsonl(path.join(dir, UPSTREAM_LOG));
  const byFixture = new Map();
  const index = readJsonl(path.join(dir, UPSTREAM_INDEX));
  if (index.length) {
    for (const { id, from, to } of index) byFixture.set(id, all.slice(from, to));
    return byFixture;
  }
  let at = 0;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of files) {
    const count = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).upstream?.length ?? 0;
    byFixture.set(file.replace(/\.json$/, ""), all.slice(at, at + count));
    at += count;
  }
  if (at !== all.length) throw new Error(`${dir}: ${all.length} logged upstream requests but its fixtures account for ${at}`);
  return byFixture;
}

export function compareUpstreamDirs(expectedDir, actualDir, allowlist = [], known = []) {
  const expected = requestsByFixture(expectedDir);
  const actual = requestsByFixture(actualDir);
  const diffs = [];
  for (const id of [...new Set([...expected.keys(), ...actual.keys()])].sort()) {
    for (const d of upstreamDiffs(expected.get(id) ?? [], actual.get(id) ?? [], allowlist)) diffs.push({ file: id, ...d });
  }
  const matches = (k, d) => k.file === d.file && k.path === d.path && (!("actual" in k) || same(k.actual, d.actual));
  const unlisted = diffs.filter((d) => !known.some((k) => matches(k, d)));
  const stale = known.filter((k) => !diffs.some((d) => matches(k, d)));
  return { diffs, unlisted, stale };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--known");
  const knownFile = at < 0 ? undefined : args.splice(at, 2)[1];
  const [expectedDir, actualDir] = args;
  if (!expectedDir || !actualDir) {
    console.error("usage: bun tests/parity/compare-upstream.mjs <expectedDir> <actualDir> [--known <file>]");
    process.exit(2);
  }
  const { diffs, unlisted, stale } = compareUpstreamDirs(expectedDir, actualDir, loadAllowlist(), loadKnownUpstreamDiffs(knownFile && path.resolve(knownFile)));
  for (const d of unlisted) console.error(`${d.file} ${d.message}`);
  for (const k of stale) console.error(`STALE known-upstream-diff ${k.file} ${k.path}: no longer occurs`);
  console.log(`${diffs.length} upstream diffs (${unlisted.length} unlisted, ${stale.length} stale known)`);
  process.exit(unlisted.length || stale.length ? 1 : 0);
}
