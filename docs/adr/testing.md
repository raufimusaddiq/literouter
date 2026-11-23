# Testing

## Runner

- **Always run the suite with `--parallel`.** Plain `bun test` shares one module registry, so a `vi.mock` leaks across files; `--parallel` isolates per file (`BUN_TEST_WORKER_ID`). `vi.test.js` spawns a child `bun test --parallel` over the isolation fixtures and requires both cases present and none skipped, because a skipped assertion proves nothing. Where: `tests/helpers/vi.test.js`.
- **`tests/bunfig.toml` ignores `**/.claude/**`, `**/node_modules/**`, `**/dist/**` and `*.live.test.js`**: nested worktrees have no installed deps (collection fails) and live tests must never gate CI. Bun applies the ignore list even to explicitly named files; run a live test by overriding: `bun test --path-ignore-patterns='**/node_modules/**' ./unit/file.live.test.js` from `tests/`.
- **Bun's junit omits load-time failures**: a broken file just vanishes and root `errors` is never set. `verify-no-regression.mjs` fails on any root `errors`; the per-file case-count gate was retired, so a test that disappears is caught in review. Where: `tests/__baseline__/verify-no-regression.mjs`.

## Bun test quirks

- **Set `DATA_DIR` before importing anything that touches the DB**, via dynamic `import()` (static imports hoist above the assignment and open the real data directory). `vi.mock` is not hoisted either: register it before the first import of any module that reads the value at load.
- **`vi` re-exports Bun's own function references** (`mock`, `fn`, `spyOn`, `useFakeTimers`, `clearAllMocks`); wrapping `vi.mock` changes which file Bun treats as the caller and breaks relative specifiers. Where: `tests/helpers/vi.js`.
- **There is no `doUnmock`, and `?actual` re-mocking does not restore live bindings**: a test needing the real module after a mock must come last in its file (`kiro-external-idp.test.js` tests 4 and 5).
- **Bun links ESM strictly**: a `vi.mock` factory omitting a named export some importer uses fails at load with `Export named 'X' not found` and the file shows 0 tests; spread `await import(spec + "?actual")` or add `vi.fn()` exports (check the actual module's side effects first, e.g. opening the DB).
- **A mocked `translator/index.js` needs a synchronous factory**: translators import `register` from it, so an async factory awaiting `?actual` deadlocks. Import the real index first.
- **`vi.resetModules` deletes `require.cache` keys not under `node_modules`.**
- **Fake timers**: Bun freezes `Date.now`, `performance.now`, `Bun.nanoseconds`, `process.hrtime` (not `setImmediate`) and ignores `toFake`. `expect(p).rejects` deadlocks when `p` settles from a fake timer: use `p.then(() => null, e => e)`. Bound wait loops by iteration count, not a clock. `advanceTimersByTimeAsync` jumps deadline to deadline with a re-armed sentinel at the window end, flushes microtasks per jump, floors fractional ms (Bun's delay 0 is 1 ms); advancing by 0 repeats `advanceTimersByTime(0)` (max 100 passes) and restores the clock with `setSystemTime`, so a 1 ms timer also fires.
- **`toMatchObject` with `expect.any` mutates the received object**; assert such fields separately.
- **`it.each` placeholders**: `%s` only interpolates strings, `%d/%i/%f` numbers, `%o` prints a literal `O`; use `%p`, `%j`, `%#`, `$prop`. A title with no placeholder gives every row the same name (add `%#`); `verify-no-regression.mjs` warns on duplicate `file :: name` keys.
- **`tests/unit/system-ca-trust.test.js` asserts Bun's behaviour** (`tls.setDefaultCACertificates` does not affect `fetch`); the server wiring is covered by `tests/server/ca.test.js`.

## Lean tests

- **One behaviour per test; data-only variants are rows of one `it.each`/`describe.each` table.** Shared setup lives in `tests/helpers/` and is deleted with its last user; every fixture has a user; every test file asserts something; no test asserts only helpers it defines or restates the implementation.
- **Merging or deleting tests needs an assertion proof**: name the cases and show before/after assertion lists in the PR (the count guard was retired because it blocked every legitimate merge and did not constrain growth).
- **`scripts/check-test-hygiene.mjs --check` fails on**: an unreferenced fixture (basename mentioned by no test/script/workflow; a README mention does not count), a helper nobody imports, a `*.test.js` with no assertion, an exact duplicate title within one `describe`. A fixture loaded by directory listing goes in `DIR_LOADED_ALLOW` with a reason (empty today). Where: `scripts/check-test-hygiene.mjs`, `tests/unit/test-hygiene.test.js`.
