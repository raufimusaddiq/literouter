// Usage: bun tests/__baseline__/record-test-counts.mjs <vitest-json> [out-file]
// Freezes the per-file test count (every assertionResult, any status) from a vitest JSON report.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const [resultsPath, outPath] = process.argv.slice(2);
if (!resultsPath) { console.error("Missing vitest json path"); process.exit(2); }

// Same rule as relative() in verify-no-regression.mjs (copied; keep in sync).
const relative = name => {
  const n = name.split(String.fromCharCode(92)).join("/");
  const j = n.lastIndexOf("/tests/");
  return j >= 0 ? n.slice(j + 1) : n;
};

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const files = {};
for (const f of r.testResults) {
  const k = relative(f.name);
  files[k] = (files[k] || 0) + f.assertionResults.length;
}
const sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
const recordedFrom = execSync("git rev-parse HEAD").toString().trim();
const out = JSON.stringify({ recordedFrom, files: sorted }, null, 2) + "\n";
if (outPath) writeFileSync(outPath, out); else process.stdout.write(out);
