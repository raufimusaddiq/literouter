# ADR-0052: Test harness and configuration

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit; extended with the vitest to `bun test` migration reasoning

## Context

The test suite in `tests/` is an independent package that runs on `bun test` and imports application code from `src/`. Many modules read environment configuration (such as `DATA_DIR`) when first imported and open the database immediately, and the repository often contains nested git worktrees. The suite was migrated from vitest, so the harness keeps a vitest-compatible `vi` helper, a re-runnable codemod, and junit-based regression and test-count gates. These constraints shape how tests must be written and how the runner is configured.

## Decisions

### D1. Tests that set DATA_DIR must import the DB layer dynamically

`DATA_DIR` has to be in place before the DB layer's first import, because paths and the database are resolved at load time. Tests that need an isolated data directory therefore set `process.env.DATA_DIR` first and then use dynamic `import()` for modules that touch the DB; static imports are hoisted above the assignment and would open the real data directory.

**Where:** `tests/unit/commandcode-live-models.test.js`; `tests/unit/zed-live-models.test.js`; `tests/unit/zed-native-auth.test.js`; `tests/unit/model-catalog-scope.test.js`

### D2. bun test must not scan nested worktrees and must not run live tests in CI

Git worktrees nested under `.claude/` carry their own copies of the test files but lack an installed `node_modules` (open-sse and others), so provider imports fail during collection; `tests/bunfig.toml` `pathIgnorePatterns` excludes `**/.claude/**`, `**/node_modules/**` and `**/dist/**`. `*.live.test.js` files hit real upstreams and must never gate CI, so the same `pathIgnorePatterns` excludes them. Bun applies the ignore list even to a file named explicitly on the command line, so a live test is run by hand by overriding the list from `tests/`: `bun test --path-ignore-patterns='**/node_modules/**' ./unit/file.live.test.js`.

**Where:** `tests/bunfig.toml`: `pathIgnorePatterns`

### D3. The `vi` helper re-exports bun's own function references

`tests/helpers/vi.js` builds `vi` by copying the members Bun implements by reference and adding only the missing ones. Wrapping `vi.mock` would change which file Bun treats as the caller, and relative `vi.mock` specifiers resolve against the calling test file, so `vi.mock` must remain the very same function Bun exports. `vi.test.js` pins this by asserting reference equality for `mock`, `fn`, `spyOn`, `useFakeTimers` and `clearAllMocks`, and a fixture in a nested directory pins relative resolution.

**Where:** `tests/helpers/vi.js`; `tests/helpers/vi.test.js`; `tests/helpers/__fixtures__/nested/relative-mock.test.js`

### D4. Per-file isolation needs `--parallel`, and the isolation pin spawns a child run

Plain `bun test` shares one module registry across all files, so a `vi.mock` in one file can leak into others; `bun test --parallel` runs files in isolated workers (marked by `BUN_TEST_WORKER_ID`). The isolation fixture therefore asserts the mock does not leak only when that variable is set and skips itself otherwise. A skipped assertion proves nothing, so `vi.test.js` spawns a child `bun test --parallel` over the two fixture files with a junit reporter and requires both cases to be present and none skipped, failed or errored. The child receives explicit fixture paths only, so it never collects `vi.test.js` and cannot recurse.

**Where:** `tests/helpers/__fixtures__/isolation.test.js`; `tests/helpers/vi.test.js`

### D5. `vi.resetModules` deletes `require.cache` keys

Bun has no `resetModules`. The helper deletes every `require.cache` key that is not under `node_modules`, so the next import of a user module re-evaluates it while dependencies keep their loaded state.

**Where:** `tests/helpers/vi.js`: `resetModules`

### D6. `advanceTimersByTimeAsync` jumps between deadlines

Stepping every millisecond is too slow for hour-long windows, so the helper jumps from deadline to deadline:

- A sentinel timer at the window end guarantees `advanceTimersToNextTimer` never lands past the window. The sentinel is re-armed (as the newest timer) before every jump so timers created inside the window with a deadline exactly at the window end still fire before it.
- Microtasks are flushed after every jump so timers created by awaited callbacks also fire.
- Elapsed time is measured with `Date.now()`, so a callback that calls `setSystemTime` mid-window skews it.
- Bun's timer clock has integer-millisecond resolution and treats delay 0 as 1 ms, so fractional milliseconds are floored and the window never over-advances.

**Where:** `tests/helpers/vi.js`: `advanceTimersByTimeAsync`; `tests/helpers/vi.test.js`

### D7. `advanceTimersByTimeAsync(0)` repeats `advanceTimersByTime(0)` and restores the clock

Like vitest, advancing by 0 must fire timers due now (`setTimeout(fn)`, `setTimeout(fn, 0)`) and delay-0 timers scheduled by their awaited callbacks. Bun can only do this through `advanceTimersByTime(0)`, so the helper repeats it (at most 100 passes) while the timer count drops. Each pass moves Bun's timer clock by 1 ms, so `Date.now()` is restored with `setSystemTime`. Two differences from vitest remain: the internal timer clock still drifts 1 ms per pass, and Bun cannot tell `setTimeout(fn, 0)` from `setTimeout(fn, 1)`, so a 1 ms timer also fires.

**Where:** `tests/helpers/vi.js`: `advanceTimersByTimeAsync`

### D8. The junit gates catch load failures through counts, not errors

Bun does not report load-time failures ("Unhandled error between tests") in the junit: the broken file is simply absent and the root `errors` attribute is never set. Throws from timers and unhandled rejections are attributed to the running test as a failure. `verify-no-regression.mjs` therefore treats any root `errors` above 0 as a defensive, strict failure, and `verify-test-counts.mjs` catches load failures because a baseline file missing from the junit counts as 0 cases, below its recorded count. The count gate also reports a path mismatch when no junit path matches a baseline key, which happens when the run is not started from `tests/`; paths in the report may be absolute or backslashed and are normalised to `tests/<path>` to match the known-fails keys. `record-test-counts.mjs` freezes counts from a vitest JSON report, one per assertion of any status, and `*.live.test.js` files are absent because they are ignored (D2).

**Where:** `tests/__baseline__/junit.mjs`; `tests/__baseline__/verify-no-regression.mjs`; `tests/__baseline__/verify-test-counts.mjs`; `tests/__baseline__/record-test-counts.mjs`

### D9. system-ca-trust has a count override

`tests/unit/system-ca-trust.test.js` failed to load under vitest on Windows (it cannot find `custom-server.js`), so the vitest report held no assertions for it and the frozen baseline would have recorded 0. `test-counts-overrides.json` records the 5 `it()` calls counted statically, with no each, loops or conditionals, and `record-test-counts.mjs` warns on stderr about any zero-assertion file without an override.

**Where:** `tests/__baseline__/test-counts-overrides.json`; `tests/__baseline__/record-test-counts.mjs`

### D10. The codemod keeps vitest-specific shapes for manual review

`scripts/migrate-vitest-to-bun.mjs` is re-run on every merge from staging, which keeps bringing vitest-style tests, until the cutover. It rewrites only shapes with an exact Bun equivalent: named vitest imports, `vi.doMock`, `.fails`, and a missing `vi` import. Shapes with no exact equivalent (`importActual`, `importOriginal`, `doUnmock`, `expectTypeOf`, `assertType`, other vitest import forms) are reported as manual-review items and left unchanged rather than guessed at, so a human decides each one. It works on a masked copy of the source with comments and string text blanked, so a vitest import mentioned in a comment or string is never rewritten. It never adds comments; its `--snapshots` mode converts `.snap` files by changing the header and replacing the ` > ` key separator with a space, and re-lays multi-line string values out the way Bun prints them. `--check` exits non-zero when any file would change.

**Where:** `scripts/migrate-vitest-to-bun.mjs`; `tests/unit/migrate-vitest-to-bun.test.js`

## Consequences

- Static imports of DB-touching modules in these tests write to or read the developer's real data directory.
- Scanning nested worktrees makes provider imports fail during collection.
- Including live tests in the default run makes CI depend on provider availability and credentials.
- Wrapping `vi.mock` silently breaks relative mock specifiers.
- Without `--parallel`, mocks can leak between test files.
- A broken test file disappears from the junit instead of failing, so the count gate is the only thing that notices it.
- Tests that rely on advancing by 0 can see 1 ms timers fire early and a drifting internal timer clock.
