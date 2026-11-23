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

_Superseded in part: `verify-test-counts.mjs` and `record-test-counts.mjs` were removed after the production cutover. `verify-no-regression.mjs` and `junit.mjs` remain._

Bun does not report load-time failures ("Unhandled error between tests") in the junit: the broken file is simply absent and the root `errors` attribute is never set. Throws from timers and unhandled rejections are attributed to the running test as a failure. `verify-no-regression.mjs` therefore treats any root `errors` above 0 as a defensive, strict failure, and `verify-test-counts.mjs` catches load failures because a baseline file missing from the junit counts as 0 cases, below its recorded count. The count gate also reports a path mismatch when no junit path matches a baseline key, which happens when the run is not started from `tests/`; paths in the report may be absolute or backslashed and are normalised to `tests/<path>` to match the known-fails keys. `record-test-counts.mjs` freezes counts from a vitest JSON report, one per assertion of any status, and `*.live.test.js` files are absent because they are ignored (D2).

Usage: `bun tests/__baseline__/verify-no-regression.mjs <junit.xml>` and `bun tests/__baseline__/verify-test-counts.mjs <junit.xml>`, run from the repo root after `bun test` from `tests/`. Exit codes: 0 ok, 1 regression or count drop, 2 bad usage (missing path).

**Where:** `tests/__baseline__/junit.mjs`; `tests/__baseline__/verify-no-regression.mjs`; `tests/__baseline__/verify-test-counts.mjs`; `tests/__baseline__/record-test-counts.mjs`

### D9. system-ca-trust has a count override

_Superseded: the count baseline and its overrides were removed after the production cutover. Kept for history._

`tests/unit/system-ca-trust.test.js` failed to load under vitest on Windows (it cannot find `custom-server.js`), so the vitest report held no assertions for it and the frozen baseline would have recorded 0. `test-counts-overrides.json` records the 5 `it()` calls counted statically, with no each, loops or conditionals, and `record-test-counts.mjs` warns on stderr about any zero-assertion file without an override.

**Where:** `tests/__baseline__/test-counts-overrides.json`; `tests/__baseline__/record-test-counts.mjs`

### D10. The codemod keeps vitest-specific shapes for manual review

_Superseded: the vitest-to-bun codemod and its CI steps were removed after the production cutover. Kept for history._

The vitest-to-bun codemod (removed) was re-run on every merge from staging, which keeps bringing vitest-style tests, until the cutover. It rewrites only shapes with an exact Bun equivalent: named vitest imports, `vi.doMock`, `.fails`, and a missing `vi` import. Shapes with no exact equivalent (`importActual`, `importOriginal`, `doUnmock`, `expectTypeOf`, `assertType`, other vitest import forms) are reported as manual-review items and left unchanged rather than guessed at, so a human decides each one. It works on a masked copy of the source with comments and string text blanked, so a vitest import mentioned in a comment or string is never rewritten. It never adds comments; its `--snapshots` mode converts `.snap` files by changing the header and replacing the ` > ` key separator with a space, and re-lays multi-line string values out the way Bun prints them. `--check` exits non-zero when any file would change. 

**Where:** the vitest-to-bun codemod and its test (removed)

### D11. Module mocks are not hoisted and cannot be undone within a file

Bun does not hoist `vi.mock`, so a mock must be registered before the first import of any module that reads the mocked value at load time. Use dynamic imports after the `vi.mock` call; this matters most for data-dir mocks, where a static import opens the real database first (see D1). `vi.doUnmock` does not exist, and re-mocking with `?actual` does not restore live bindings, because modules that already imported the mocked module keep the mock. A test that needs the real module after a mock must therefore come last in its file: tests 4 and 5 of `kiro-external-idp.test.js` must stay last.

**Where:** `tests/unit/kenari-provider.test.js`; `tests/unit/literouter-rr-cursor.test.js`; `tests/unit/kiro-external-idp.test.js`

### D12. Bun links ESM strictly, so partial mock factories break the whole file

A `vi.mock(spec, factory)` whose factory omits a named export that some importer uses fails at load with `SyntaxError: Export named 'X' not found`, and the file then shows 0 tests. Spread `await import(spec + "?actual")` into the factory, or add the missing exports as `vi.fn()`. Spreading the actual module can run its side effects, such as opening the database, so check that first.

**Where:** `tests/unit/codex-compact.test.js`; `tests/unit/systemone.test.js`; `tests/unit/zed-usage.test.js`; `tests/unit/key-access.test.js`; `tests/unit/kimi-responses-transport.test.js`

### D13. An async `translator/index.js` factory that awaits `?actual` deadlocks

Translators import `register` from the mocked index, so an async factory that awaits the actual index waits on modules that wait on the factory. Import the real index first and give `vi.mock` a synchronous factory.

**Where:** `tests/unit/provider-thinking-on-off-override.test.js`; `tests/unit/minimax-transport-target-format.test.js`

### D14. Fake timers: what Bun freezes and how to wait under them

Bun's fake timers ignore `toFake`, and the helper maps a Date-only `toFake` to `setSystemTime`. They freeze `Date.now`, `performance.now`, `Bun.nanoseconds` and `process.hrtime`; `setImmediate` is not faked. `expect(p).rejects` deadlocks under fake timers when `p` settles from a fake timer, so capture the rejection with `p.then(() => null, e => e)` instead. Wait loops must be bounded by iteration count, never by a clock, because the clock does not move.

**Where:** `tests/helpers/vi.js`; `tests/unit/usage-route-cache.test.js`

### D15. `toMatchObject` with `expect.any` mutates the received object

Bun's `toMatchObject` replaces received values with the `expect.any(...)` matcher, so later assertions on the same object see the matcher. Assert such fields separately or on a copy.

**Where:** `tests/unit/provider-pricing-minimax-m3.test.js`

### D16. `it.each` placeholders and duplicate names

`%s` interpolates only strings, `%d`, `%i` and `%f` only numbers, and `%o` prints a literal `O`; `%p`, `%j`, `%#` and `$prop` work. The codemod rewrites `%s` and `%o` to `%p`, and `verify-no-regression.mjs` warns on duplicate `file :: name` keys. An `.each` title with no placeholder gives every row the same name; add `%#` so the names stay distinct (`codex-compact.test.js`, `kiro-terminal-integrity.test.js`).

**Where:** `tests/__baseline__/verify-no-regression.mjs`; `tests/unit/codex-compact.test.js`; `tests/unit/kiro-terminal-integrity.test.js`

### D17. The CA trust test asserts Bun's behaviour, not the server wiring

`system-ca-trust.test.js` asserts how Bun honours `NODE_EXTRA_CA_CERTS`. The `useSystemCaStore` wiring that `custom-server.js` had is now `src/server/ca.js`, covered at startup by `tests/server/ca.test.js` (the file is waived to it in `test-counts.json`). `tls.setDefaultCACertificates` does not affect Bun's `fetch`. The test still calls `require("undici")` for a comparison; because the probe runs under Bun, that resolves to Bun's built-in module, so `undici` was dropped from the root dependencies and the test passes without it in `node_modules`.

**Where:** `tests/unit/system-ca-trust.test.js`; `package.json`

### D18. The suite must run with `--parallel`

Per-file module isolation needs `--parallel` (see D4). A full run took about 11 s on one Windows machine for 3996 tests across 440 files; earlier estimates of about 6 min do not hold now. The Linux CI time is still to be recorded.

**Where:** `tests/package.json`; `.github/workflows/test.yml`

### D19. Deleted tests are recorded in the count baseline

_Superseded: the count baseline was removed after the production cutover; a test merge or deletion now proves its before/after assertions in its own PR. Kept for history._

`test-counts.json` has a `"deleted": { "<file> :: <full name>": "<reason>" }` map; a whole-file deletion uses `"<file> :: *"`. `files` stays at the frozen vitest counts. `verify-test-counts.mjs` subtracts one from a file's expected count per deleted case, so a lowered count without an entry fails. A whole-file entry must state `(N cases)` equal to the frozen count and the file must run 0 cases. The gate prints the list on every run and fails when a deleted case still runs or its file has no frozen count.

**Where:** `tests/__baseline__/test-counts.json`; `tests/__baseline__/verify-test-counts.mjs`; `tests/unit/baseline-junit.test.js`

## Consequences

- Static imports of DB-touching modules in these tests write to or read the developer's real data directory.
- Scanning nested worktrees makes provider imports fail during collection.
- Including live tests in the default run makes CI depend on provider availability and credentials.
- Wrapping `vi.mock` silently breaks relative mock specifiers.
- Without `--parallel`, mocks can leak between test files.
- A broken test file disappears from the junit instead of failing, so the count gate is the only thing that notices it.
- Tests that rely on advancing by 0 can see 1 ms timers fire early and a drifting internal timer clock.
