import { readFileSync } from "node:fs";
import { parseJunit } from "./junit.mjs";

const splitKey = key => {
  const sep = key.indexOf(" :: ");
  return sep < 0 ? null : { file: key.slice(0, sep), name: key.slice(sep + 4) };
};

export function checkCounts(baselineFiles, cases, deleted = {}) {
  const actual = {};
  for (const c of cases) actual[c.file] = (actual[c.file] ?? 0) + 1;
  const dropped = {};
  const wholeFile = new Set();
  for (const key of Object.keys(deleted)) {
    const k = splitKey(key);
    if (!k) continue;
    if (k.name === "*") wholeFile.add(k.file);
    else dropped[k.file] = (dropped[k.file] ?? 0) + 1;
  }
  return Object.entries(baselineFiles)
    .filter(([file]) => !wholeFile.has(file))
    .map(([file, frozen]) => ({ file, expected: frozen - (dropped[file] ?? 0), actual: actual[file] ?? 0 }))
    .filter(r => r.actual < r.expected);
}

export function checkSkips(baselineSkipped, cases, waivers = {}) {
  const actual = {};
  for (const c of cases) {
    if (c.status === "skipped" && !c.placeholder) actual[c.file] = (actual[c.file] ?? 0) + 1;
  }
  return Object.entries(actual)
    .filter(([file, n]) => !(file in waivers) && n > (baselineSkipped[file] ?? 0))
    .map(([file, n]) => ({ file, allowed: baselineSkipped[file] ?? 0, actual: n }));
}

export function pathsMismatch(baselineFiles, cases) {
  return cases.length > 0 && !cases.some(c => c.file in baselineFiles);
}

export function checkDeleted(baselineFiles, deleted, cases) {
  const problems = [];
  for (const [key, value] of Object.entries(deleted)) {
    const k = splitKey(key);
    if (!k) { problems.push({ key, problem: "key must be '<file> :: <name>'" }); continue; }
    if (!(k.file in baselineFiles)) { problems.push({ key, problem: "file is not in the baseline files map" }); continue; }
    const fileCases = cases.filter(c => c.file === k.file);
    if (k.name === "*") {
      const stated = /\((\d+) cases?\)/.exec(String(value));
      if (!stated) problems.push({ key, problem: "value must state '(N cases)'" });
      else if (Number(stated[1]) !== baselineFiles[k.file]) problems.push({ key, problem: `stated count ${stated[1]} differs from frozen count ${baselineFiles[k.file]}` });
      else if (fileCases.length) problems.push({ key, problem: "file still present in junit" });
    } else if (fileCases.some(c => c.fullName === k.name)) {
      problems.push({ key, problem: "case still present in junit" });
    }
  }
  return problems;
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
  const deleted = baseline.deleted ?? {};
  const deletedKeys = Object.keys(deleted);
  if (deletedKeys.length) {
    console.log(`Deleted tests (${deletedKeys.length}), excluded from the baseline on purpose:`);
    deletedKeys.forEach(k => console.log(`  - ${k} -- ${deleted[k]}`));
  }
  const badDeleted = checkDeleted(baseline.files, deleted, cases);
  if (badDeleted.length) {
    console.error(`\n❌ INVALID deleted entries: ${badDeleted.length}\n`);
    badDeleted.forEach(b => console.error(`  - ${b.key}: ${b.problem}`));
    process.exit(1);
  }
  const offenders = checkCounts(baseline.files, cases, deleted);
  if (offenders.length) {
    console.error(`\n❌ TEST COUNT DROP: ${offenders.length} file(s) below baseline (expected/actual):\n`);
    offenders.forEach(o => console.error(`  - ${o.file}  ${o.expected}/${o.actual}`));
    process.exit(1);
  }
  const waivers = baseline.skipWaivers ?? {};
  const waiverKeys = Object.keys(waivers);
  if (waiverKeys.length) {
    console.log(`Skip waivers (${waiverKeys.length}), allowed to skip beyond the frozen baseline:`);
    waiverKeys.forEach(k => console.log(`  - ${k} -- ${waivers[k]}`));
  }
  const skipOffenders = checkSkips(baseline.skipped ?? {}, cases, waivers);
  if (skipOffenders.length) {
    console.error(`
❌ SKIP GROWTH: ${skipOffenders.length} file(s) skip more than the frozen vitest baseline (allowed/actual):
`);
    skipOffenders.forEach(o => console.error(`  - ${o.file}  ${o.allowed}/${o.actual}`));
    process.exit(1);
  }
  console.log(`✅ Test counts OK (${Object.keys(baseline.files).length} files at or above baseline ${baseline.recordedFrom}).`);
}
