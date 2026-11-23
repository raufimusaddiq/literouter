import { readFileSync } from "node:fs";
import { parseJunit } from "./junit.mjs";

export function checkCounts(baselineFiles, cases) {
  const actual = {};
  for (const c of cases) actual[c.file] = (actual[c.file] ?? 0) + 1;
  return Object.entries(baselineFiles)
    .map(([file, expected]) => ({ file, expected, actual: actual[file] ?? 0 }))
    .filter(r => r.actual < r.expected);
}

export function pathsMismatch(baselineFiles, cases) {
  return cases.length > 0 && !cases.some(c => c.file in baselineFiles);
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) { console.error("Missing junit.xml path"); process.exit(2); }
  const baseline = JSON.parse(readFileSync(new URL("./test-counts.json", import.meta.url), "utf8"));
  const { cases } = parseJunit(readFileSync(path, "utf8"));
  if (pathsMismatch(baseline.files, cases)) {
    console.error("❌ junit paths don't match baseline keys — run bun test from tests/");
    process.exit(1);
  }
  const offenders = checkCounts(baseline.files, cases);
  if (offenders.length) {
    console.error(`\n❌ TEST COUNT DROP: ${offenders.length} file(s) below baseline (expected/actual):\n`);
    offenders.forEach(o => console.error(`  - ${o.file}  ${o.expected}/${o.actual}`));
    process.exit(1);
  }
  console.log(`✅ Test counts OK (${Object.keys(baseline.files).length} files at or above baseline ${baseline.recordedFrom}).`);
}
