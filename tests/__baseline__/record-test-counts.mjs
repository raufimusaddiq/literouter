// Usage: bun tests/__baseline__/record-test-counts.mjs <vitest-json> [out-file] [--sha <sha>]
// Freezes the per-file test count (every assertionResult, any status) from a vitest JSON report.
// Files that failed to load (0 assertions) need an entry in test-counts-overrides.json
// ({ "<key>": { "count": N, "reason": "..." } }); otherwise a warning is printed to stderr.
// *.live.test.js files are intentionally absent because vitest excluded them.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let sha;
const si = args.indexOf("--sha");
if (si >= 0) { sha = args[si + 1]; args.splice(si, 2); }
const [resultsPath, outPath] = args;
if (!resultsPath) { console.error("Missing vitest json path"); process.exit(2); }

// Same rule as relative() in verify-no-regression.mjs (copied; keep in sync).
const relative = name => {
  const n = name.split(String.fromCharCode(92)).join("/");
  const j = n.lastIndexOf("/tests/");
  return j >= 0 ? n.slice(j + 1) : n;
};

const overridesPath = join(dirname(fileURLToPath(import.meta.url)), "test-counts-overrides.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const files = {};
const loadFailed = new Set();
for (const f of r.testResults) {
  const k = relative(f.name);
  files[k] = (files[k] || 0) + f.assertionResults.length;
  if (f.assertionResults.length === 0 && f.status === "failed") loadFailed.add(k);
}
for (const k of Object.keys(files)) {
  if (files[k] > 0) continue;
  const o = overrides[k];
  if (o) {
    console.error(`override: ${k} 0 -> ${o.count} (${o.reason})`);
    files[k] = o.count;
  } else {
    console.error(`WARNING: ${k} has 0 assertions${loadFailed.has(k) ? " (suite failed to load)" : ""} and no override`);
  }
}
const sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
const recordedFrom = sha || execSync("git rev-parse HEAD").toString().trim();
const out = JSON.stringify({ recordedFrom, files: sorted }, null, 2) + "\n";
if (outPath) writeFileSync(outPath, out); else process.stdout.write(out);
