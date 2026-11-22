// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: bun tests/__baseline__/verify-no-regression.mjs <junit.xml>
// Exit: 0 ok, 1 regression, 2 bad usage.
import { readFileSync } from "node:fs";
import { parseJunit } from "./junit.mjs";

// Bun does NOT report load-time failures ("Unhandled error between tests") in the junit:
// the broken file is simply absent, and root `errors` is not set. Those are caught by
// verify-test-counts.mjs (a baseline file missing from the junit counts as 0 < baseline).
// Throws from timers / unhandled rejections are attributed to the running test as <failure>.
// The root `errors` check here is only a defensive fallback and is strict: any errors > 0 fails.
export function findRegressions({ cases, errors }, knownFails) {
  const nowFails = cases.filter(c => c.status === "failed").map(c => c.file + " :: " + c.fullName);
  const regressions = nowFails.filter(f => !knownFails.has(f));
  return { nowFails, regressions, unattributedErrors: errors > 0 ? errors : 0 };
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
      console.error(`\n❌ REGRESSION: ${unattributedErrors} error(s) between tests reported by junit root`);
    }
    process.exit(1);
  }
  console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
}
