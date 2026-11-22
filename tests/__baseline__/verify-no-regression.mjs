// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: bun tests/__baseline__/verify-no-regression.mjs <junit.xml>
// Exit: 0 ok, 1 regression, 2 bad usage.
import { readFileSync } from "node:fs";
import { parseJunit } from "./junit.mjs";

// Errors between tests (root `errors` attr) cannot be attributed per file: Bun only
// reports them on <testsuites>. They are tolerated only when at least one known-fail
// test is among the failures (expected-red environment); otherwise any error fails.
export function findRegressions({ cases, errors }, knownFails) {
  const nowFails = cases.filter(c => c.status === "failed").map(c => c.file + " :: " + c.fullName);
  const regressions = nowFails.filter(f => !knownFails.has(f));
  const hasKnownFail = nowFails.some(f => knownFails.has(f));
  return { nowFails, regressions, unattributedErrors: errors > 0 && !hasKnownFail ? errors : 0 };
}

if (import.meta.main) {
  const knownFails = new Set(
    readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
      .split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"))
  );
  const resultsPath = process.argv[2];
  if (!resultsPath) { console.error("Missing junit.xml path"); process.exit(2); }

  const parsed = parseJunit(readFileSync(resultsPath, "utf8"));
  const { nowFails, regressions, unattributedErrors } = findRegressions(parsed, knownFails);

  if (regressions.length || unattributedErrors) {
    if (regressions.length) {
      console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
      regressions.forEach(f => console.error("  - " + f));
    }
    if (unattributedErrors) {
      console.error(`\n❌ REGRESSION: ${unattributedErrors} error(s) between tests, no known-fail to attribute them to`);
    }
    process.exit(1);
  }
  console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
}
