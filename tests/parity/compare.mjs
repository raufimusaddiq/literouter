import fs from "node:fs";
import path from "node:path";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diffValues(expected, actual, at = "") {
  if (same(expected, actual)) return [];
  const bothArrays = Array.isArray(expected) && Array.isArray(actual);
  const bothObjects = !bothArrays && expected && actual && typeof expected === "object" && typeof actual === "object" && !Array.isArray(expected) && !Array.isArray(actual);
  if (bothArrays) {
    const out = [];
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) out.push(...diffValues(expected[i], actual[i], `${at}[${i}]`));
    return out;
  }
  if (bothObjects) {
    const out = [];
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) out.push(...diffValues(expected[k], actual[k], at ? `${at}.${k}` : k));
    return out;
  }
  return [{ path: at, expected, actual }];
}

const listFixtures = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

export function compareDirs(expectedDir, actualDir, known = []) {
  const diffs = [];
  const files = new Set([...listFixtures(expectedDir), ...listFixtures(actualDir)]);
  for (const file of [...files].sort()) {
    const read = (dir) => {
      const p = path.join(dir, file);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined;
    };
    for (const d of diffValues(read(expectedDir), read(actualDir))) diffs.push({ file: file.replace(/\.json$/, ""), ...d });
  }
  const isKnown = (d) => known.some((k) => k.file === d.file && k.path === d.path);
  const unlisted = diffs.filter((d) => !isKnown(d));
  const stale = known.filter((k) => !diffs.some((d) => d.file === k.file && d.path === k.path));
  return { diffs, unlisted, stale };
}

export function loadKnownDiffs(file = new URL("./known-diffs.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (import.meta.main) {
  const [expectedDir, actualDir] = process.argv.slice(2);
  if (!expectedDir || !actualDir) {
    console.error("usage: bun tests/parity/compare.mjs <expectedDir> <actualDir>");
    process.exit(2);
  }
  const { diffs, unlisted, stale } = compareDirs(expectedDir, actualDir, loadKnownDiffs());
  for (const d of unlisted) console.error(`DIFF ${d.file} ${d.path || "(root)"}\n  expected: ${JSON.stringify(d.expected)}\n  actual:   ${JSON.stringify(d.actual)}`);
  for (const k of stale) console.error(`STALE known-diff ${k.file} ${k.path}: no longer occurs`);
  console.log(`${diffs.length} diffs (${unlisted.length} unlisted, ${stale.length} stale known)`);
  process.exit(unlisted.length || stale.length ? 1 : 0);
}
