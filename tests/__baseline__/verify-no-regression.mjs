import { readFileSync } from "fs";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
);

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

const relative = name => {
  const n = name.split(String.fromCharCode(92)).join("/");
  const j = n.lastIndexOf("/tests/");
  return j >= 0 ? n.slice(j + 1) : n;
};

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const nowFails = r.testResults.flatMap(f =>
  f.assertionResults.filter(a => a.status === "failed")
    .map(a => relative(f.name) + " :: " + a.fullName)
);

const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
