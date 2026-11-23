# Bun Rewrite — Plan 1: Test Suite on `bun test` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole test suite from vitest/Node to `bun test`, losing no tests, and make the engine code it exercises Bun-native. The app still runs as Next, but on Bun (`bun --bun next`).

**Architecture:** First freeze a per-file test-count baseline from vitest. Then convert all 429 test files with a re-runnable codemod plus a small `vi` compatibility helper (`tests/helpers/vi.js`). Fix the ~38 failing files cause by cause. Where a failure is a real Bun incompatibility in runtime code (Bun ships a stub `undici`), replace the Node-only code with the Bun-native equivalent. CI on `staging` switches to `oven-sh/setup-bun`.

**Tech Stack:** Bun 1.4.4 (`bun:test`, native `fetch` with `proxy`/`tls.serverName`, `bun:sqlite`), plain JS ESM.

**Spec:** `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` (§2.8, §6.8, §7 phase 1b, §9.1–9.3). This plan covers the part of §9.1 the existing tests reach: undici, proxies and the SSRF pin. The per-executor Bun smoke tests against a mock upstream (Cursor `node:http2`, zstd, binary streams) are written in Plan 2. Plans 2–5 (Bun server, dashboard SPA, packaging/CLI/CI, parity and cutover) are written after this one lands, using what it finds.

## Global Constraints

- Bun version pinned to **1.4.4** everywhere (`tests/package.json` `engines.bun`, root `package.json` `engines.bun`, CI `bun-version: 1.4.4`).
- **No test may be deleted or weakened.** Every file in the vitest baseline keeps at least its baseline test count (§Task 1), and its assertions keep checking the same behaviour. If a test asserted an undici-only mechanism that no longer exists, it is replaced by a test of the same user-visible behaviour, and the PR description lists `old test → new test` for each one.
- No `vitest`, `vite`, `node --test` or `actions/setup-node` left on `staging` when this plan ends. The app itself still depends on `next` until Plan 2.
- Runtime code changes (in `src/` and `open-sse/`) may be Bun-only. `staging` is never deployed before cutover, and the interim app runs through `bun --bun next` (the existing `dev:bun`/`build:bun`/`start:bun` scripts).
- Linux CI: `bun test` exits 0, the same as today's "expected red is 0". Windows dev runs are judged with `bun tests/__baseline__/verify-no-regression.mjs <junit.xml>` against `known-fails.txt`.
- The SSRF guarantee is unchanged: an image fetch connects only to the IP that passed validation (no second DNS lookup), and redirects are not followed.
- Conventional Commits. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work lands on `staging` through PRs, following the rig auto-merge flow.
- Delegated or subagent work runs on **Sonnet 5.5** (`model: "sonnet"`).

## Review Focus

1. **Module mocks leaking between files.** Bun shares one module registry per process unless files are isolated. The suite must run with `--parallel` (which implies `--isolate`), and a mock in file A must never be visible in file B. Pinned by `helpers/vi.test.js` › "isolation" plus a two-file fixture (Task 2).
2. **Relative `vi.mock("./x.js")` specifiers.** 138 of them resolve relative to the test file. If the helper wraps `vi.mock` in its own function, they would resolve relative to `tests/helpers/` and silently mock nothing. Pinned in Task 2 by a test that mocks a module through a relative path from a nested directory and asserts the mock took effect.
3. **Snapshot files.** There are 17 `toMatchSnapshot` calls. Bun would quietly write fresh snapshots instead of comparing against the existing vitest `.snap` files, so a broken snapshot test turns green. Task 4 converts the `.snap` files and requires a diff showing only header and format changes. CI then runs `git diff --exit-code -- tests` after the suite, so any snapshot Bun writes or rewrites fails the build (Task 9).
4. **Unhandled errors between tests** ("Export named X not found" from partial mock factories): Bun reports these as errors, not failed tests. A gate that only counts failed tests would miss them. Task 3's verifier counts `errors` too.
5. **Hung tests that pass only because a timeout was raised.** The probe needed `--timeout=20000` and still hit timeouts. Keep the default per-test timeout of 5000 ms, the same as vitest. Task 5 fixes the root cause rather than raising timeouts. Any per-test timeout above 5000 ms needs a code comment explaining why.

---

## Probe findings this plan is built on (2026-11-22, Bun 1.4.4, Windows)

- **Full suite with a rough codemod and shim:** 3510 tests, **3331 pass**, 120 fail and 41 errors across 38 files, 58 skipped. Raw results: `C:\Users\KOMPUTER\AppData\Local\Temp\claude\680b3c0368b65e0c\3e4ce144-be4b-4e34-ac1d-24ec5555884a\scratchpad\bun-probe-junit.xml`. That scratchpad file may be gone, so rerun if needed.
- **`bun:test` `vi` has:** `fn`, `mock` (patches the live bindings of static imports, and survives `require.cache` deletion), `spyOn`, `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `useFakeTimers`, `useRealTimers`, `advanceTimersByTime`, `runAllTimers`, `getTimerCount`. `jest.setSystemTime` also exists.
- **Missing from `vi`:** `hoisted`, `resetModules`, `setSystemTime`, `advanceTimersByTimeAsync`, `stubGlobal`, `unstubAllGlobals`, `stubEnv`, `unstubAllEnvs`, `mocked`, `doMock`, `doUnmock`, `importActual`, `waitFor`. Also missing: `it.fails` (Bun calls it `test.failing`) and the factory argument `importOriginal`.
- **Workarounds that work:**
  - Deleting non-`node_modules` keys from `require.cache` gives fresh ESM module instances, and module mocks persist through it.
  - `import("./x.js?actual")` returns a fresh, unmocked instance.
  - `jsconfig.json` paths (`@/*`, `open-sse/*`) resolve natively.
  - `--parallel`/`--isolate` gives per-file module isolation.
  - `--path-ignore-patterns` and `--reporter=junit --reporter-outfile` exist.
- **Junit layout:** a file-level `<testsuite>` wraps nested `<testsuite>`s, one per `describe`, which wrap the `<testcase>`s. A vitest `fullName` equals the nested describe names plus the test name, joined with spaces.
- **Bun's `undici` is a built-in stub:** `new Agent().close` is `undefined`, and Bun ignores `dispatcher` and `connect.lookup`. Bun's native `fetch(\`https://${ip}/\`, { headers: { Host }, tls: { serverName: host } })` succeeds with full certificate verification; without `serverName` it fails with `EPROTO`.

Failure clusters, which own Tasks 5–9:

| Cluster | Files (from the probe) | Task |
|---|---|---|
| A. `EBUSY` removing the temp `DATA_DIR` on Windows: the SQLite handle is still open | api-key-cache-access, api-key-usage-query, cached-token-e2e, compatible-provider-connections, db-concurrent, db-migration-chain, db-null-byte-params, db-sqlite-vs-lowdb, key-access-migration, key-hardening, legacy-json-import-fingerprint, model-routing, provider-priority-insert-cost, request-details-tab, zed-live-models, zed-native-auth | 6 |
| B. Partial mock factories ("Export named X not found"), `importOriginal`, `orig is not a function` | force-stream-config, provider-thinking-on-off-override, minimax-transport-target-format, perf-hotpath-2, files that log "Unhandled error between tests" (stream.js `formatSSE`, usageDb `trackPendingRequest`, db `getModelAliases`/`updateSettings`, kvStore `invalidateKvScope`) | 5 |
| C. undici on Bun | codex-image-fetch, image-fetch-hardening, ssrf-image-security, ssrf-guard-hardening, proxy-dispatcher-eviction, proxyfetch-backstop, perf-hotpath-2 (undici part), plus `src/lib/network/proxyTest.js` and `src/app/api/proxy-pools/[id]/test/route.js` | 7 |
| D. Timeouts and a worker crash | app-timezone, usage-lastused-timezone, usage-route-cache, opencode-overload-retry, gateway-timeouts (crash) | 5 |
| E. Driver/runtime assumptions | db-driver-chain, request-details-tab (`better-sqlite3` import), system-ca-trust, headroom-detect, provider-pricing-minimax-m3 | 8 |
| F. `node --test` file | unit/custom-server-h2c.test.cjs | 8 |
| G. Windows-only, already in known-fails | deploy-script, plus the rest of `known-fails.txt` | 3 (key mapping only) |
| H. Live tests | `*.live.test.js` (e.g. mimo-free.live) must be excluded, as vitest did | 2 |

---

### Task 0: Publish `staging` at the new base

`staging` was already fast-forwarded locally to `main` (30ceec8d), and the design doc was committed as 07ce723b. Neither is pushed yet.

- [x] **Step 1:** Get the owner's OK, then run `git push origin staging`. This is a fast-forward of a stale branch with no unique commits. — superseded by PR #206.
- [x] **Step 2:** Make the branch protection on `staging` match `main` (same required checks). Verify with `gh api repos/{owner}/{repo}/branches/staging/protection`. — done by the owner (staging requires `unit` + `Hermes Review`).

### Task 1: Freeze the vitest per-file test-count baseline

**Files:**
- Create: `tests/__baseline__/record-test-counts.mjs`
- Create: `tests/__baseline__/test-counts.json`

**Interfaces:**
- Produces: `test-counts.json` in the shape `{ "recordedFrom": "<git sha>", "files": { "tests/unit/x.test.js": <number of tests incl. failed/skipped> } }`. Keys use the same repo-relative form as `known-fails.txt`.

- [x] **Step 1:** While vitest still exists, run: `cd tests && npx vitest run --reporter=json --outputFile.json=../vitest-final.json`. Expected: about 3280 results, and only the entries in `known-fails.txt` fail.
- [x] **Step 2:** Implement `record-test-counts.mjs <vitest-json>`. It counts `assertionResults` per `testResults[].name` and normalises names with the same `relative()` rule as `verify-no-regression.mjs`.
- [x] **Step 3:** Run `bun tests/__baseline__/record-test-counts.mjs vitest-final.json > tests/__baseline__/test-counts.json`. Check that it has 427 or more file keys (the `.test.js` files; `.cjs` files are counted in Task 8).
- [x] **Step 4:** Commit: `test: freeze vitest per-file test counts before bun migration`.

### Task 2: `bun test` runtime and the `vi` helper

**Files:**
- Create: `tests/helpers/vi.js`
- Create: `tests/helpers/vi.test.js`, and the fixtures `tests/helpers/__fixtures__/{counter.js,dep.js,user.js,nested/relative-mock.test.js}`
- Create: `tests/bunfig.toml`
- Modify: `tests/package.json`

**Interfaces:**
- Produces: `import { vi } from "#test/vi"`. The subpath import is declared in `tests/package.json`'s `"imports": { "#test/*": "./helpers/*.js" }`.
- `vi` is a plain object. It carries **the same function references** as `bun:test`'s `vi` for everything Bun implements, so relative `vi.mock` paths still resolve against the calling test file. It adds:
  - `hoisted(fn) → fn()`
  - `resetModules()`: deletes every `require.cache` key that doesn't contain `node_modules`
  - `setSystemTime(t)` → `jest.setSystemTime(t)`
  - `advanceTimersByTimeAsync(ms): Promise<void>`
  - `stubGlobal(name, value)` / `unstubAllGlobals()`
  - `stubEnv(name, value | undefined)` / `unstubAllEnvs()`
  - `mocked(x) → x`
  - `waitFor(fn, { timeout = 1000, interval = 50 } = {}): Promise<T>`
- `vi.doMock`, `vi.doUnmock`, `vi.importActual` and `importOriginal` are **not** in the helper, because they need the caller's location. The codemod (Task 4) and the fixes (Task 5) rewrite their call sites.

- [x] **Step 1: Write the failing tests** in `tests/helpers/vi.test.js`:
  - `"hoisted returns factory value"`: `expect(vi.hoisted(() => 42)).toBe(42)`.
  - `"resetModules gives a fresh module instance and keeps mocks"`: increment `__fixtures__/counter.js`, call `vi.resetModules()`, re-import, expect `n === 0`. Also: a `vi.mock`ed `dep.js` is still mocked after the reset.
  - `"advanceTimersByTimeAsync runs timers scheduled from awaited callbacks"`: with fake timers, a `setTimeout(500)` callback awaits a resolved promise and then schedules `setTimeout(400)`. Both fire within `await vi.advanceTimersByTimeAsync(1000)`, and a `setTimeout(1001)` does not.
  - `"stubEnv/unstubAllEnvs restore set and unset vars"`: covers both `undefined` and a prior value.
  - `"stubGlobal/unstubAllGlobals restore descriptors"`: stub `globalThis.fetch` and check it is restored to the identical function.
  - `"waitFor retries until success and rethrows after timeout"`.
  - `"relative vi.mock from a nested dir resolves against the caller"`: implemented as the fixture test `__fixtures__/nested/relative-mock.test.js`, which calls `vi.mock("../dep.js", …)` via `#test/vi` and expects `user.js` to see the mock.
  - `"isolation"`: a second fixture file asserts that `dep.js` is **not** mocked. Run both fixture files in one `bun test --parallel` invocation.
- [x] **Step 2:** Run `cd tests && bun test helpers/`. Expected: FAIL (the helper doesn't exist yet).
- [x] **Step 3:** Implement `tests/helpers/vi.js`. For `advanceTimersByTimeAsync`, advance in steps and flush microtasks (`await Promise.resolve()` several times, then `await new Promise(r => setImmediate(r))`) between steps, until the requested total has elapsed. Its semantics must match vitest: timers created during the window, at times inside it, also fire.
- [x] **Step 4:** Write `tests/bunfig.toml` with `[test]` and `root = "."`. Ignore `**/*.live.test.js`, `**/node_modules/**` and `**/.claude/**` using `pathIgnorePatterns` if bunfig supports it; otherwise use `--path-ignore-patterns` in the scripts.
- [x] **Step 5:** Update `tests/package.json`:
  - Remove `vitest`; set `engines` to `{ "bun": ">=1.4.4" }`; add the `imports` map.
  - Set the scripts to `"test": "bun test --parallel"` and `"test:junit": "bun test --parallel --reporter=junit --reporter-outfile=../test-results.xml"`.
  - Delete `tests/package-lock.json`, then run `bun install`, which creates `bun.lock`.
- [x] **Step 6:** Run `cd tests && bun test helpers/`. Expected: PASS.
- [x] **Step 7:** Commit: `test: add bun test runtime and vi compatibility helper`.

### Task 3: Junit-based gates

**Files:**
- Create: `tests/__baseline__/junit.mjs`
- Modify: `tests/__baseline__/verify-no-regression.mjs`
- Create: `tests/__baseline__/verify-test-counts.mjs`
- Test: `tests/unit/baseline-junit.test.js`

**Interfaces:**
- Produces:
  - `parseJunit(xml: string) → { cases: Array<{ file: string, fullName: string, status: "passed"|"failed"|"skipped" }>, errors: number }`. `file` is repo-relative with forward slashes (for example `tests/unit/x.test.js`). `fullName` is the nested describe names plus the testcase name, joined by `" "`. `errors` is the root `errors` attribute, i.e. errors between tests.
  - CLI `verify-no-regression.mjs <junit.xml>`: exit 1 if any failed case's key `"<file> :: <fullName>"` is not in `known-fails.txt`, or if `errors > 0` outside files that have a known fail.
  - CLI `verify-test-counts.mjs <junit.xml>`: exit 1 if any file in `test-counts.json` has fewer cases than its baseline, and print each offending file with its `expected/actual` counts.

- [x] **Step 1: Write the failing tests** using an inline junit fixture: one file suite, a nested describe `"GOLDEN buildHeaders (default executor providers)"` containing a case `"cline → headers (apiKey / oauth)"` with `<failure>`, a top-level case with `<skipped/>`, a Windows backslash `file` attribute, and root `errors="2"`. Assertions:
  - `fullName === "GOLDEN buildHeaders (default executor providers) cline → headers (apiKey / oauth)"`
  - `file === "tests/translator/golden-url-header.test.js"`
  - `status` values are correct
  - `errors === 2`
  - the counts gate flags a file whose baseline is higher than its count.
- [x] **Step 2:** Run `bun test unit/baseline-junit.test.js` from `tests/`. Expected: FAIL.
- [x] **Step 3:** Implement the three modules. No XML dependency is needed: a small tag scanner is enough for Bun's junit output.
- [x] **Step 4:** Run the same command. Expected: PASS.
- [x] **Step 5:** Re-key `known-fails.txt` only if Bun's names differ from vitest's for the same test. Leave entries alone otherwise.
- [x] **Step 6:** Commit: `test: junit-based regression and test-count gates`.

### Task 4: Re-runnable codemod and the bulk conversion

**Files:**
- Create: `scripts/migrate-vitest-to-bun.mjs`
- Test: `tests/unit/migrate-vitest-to-bun.test.js`
- Modify: every `tests/**/*.test.js` (mechanical), `tests/**/__snapshots__/*.snap`
- Delete: `tests/vitest.config.js`

**Interfaces:**
- Produces: `transform(source: string, filePath: string) → string`, a pure function. CLI: `bun scripts/migrate-vitest-to-bun.mjs [--check] [paths…]`. With `--check` it exits 1 if any file still needs conversion. **Keep this script until cutover**: every `main → staging` merge brings vitest-style tests, and the merge procedure re-runs it.

Rules, in this order:
1. `import { …names } from "vitest"`: move `vi` to `import { vi } from "#test/vi"` and keep the other names in `import { … } from "bun:test"`. Handle single-line and multi-line imports, and drop type-only names (`Mock`, `MockInstance`).
2. `vi.doMock(` → `vi.mock(`. Bun's `vi.mock` isn't hoisted, so it behaves like `doMock`.
3. `it.fails(` / `test.fails(` → `.failing(`.
4. Leave `vi.importActual(spec)`, `vi.doUnmock(spec)` and `importOriginal` untouched, but list every occurrence on stderr so Task 5 handles them by hand (8 `importOriginal` files, 3 `importActual` calls, 7 `doUnmock` calls).
5. Idempotent: `transform(transform(x)) === transform(x)`.

- [x] **Step 1: Write the failing tests:**
  - A single-line import and a multi-line import, each with `vi` among other names.
  - An import without `vi`.
  - `vi.doMock("../x.js", f)` → `vi.mock("../x.js", f)`.
  - `it.fails(` → `it.failing(`.
  - The idempotence check.
  - A file that is already converted is unchanged.
- [x] **Step 2:** Run `bun test unit/migrate-vitest-to-bun.test.js`. Expected: FAIL.
- [x] **Step 3:** Implement the transform and the CLI.
- [x] **Step 4:** Run it. Expected: PASS.
- [x] **Step 5:** Run `bun scripts/migrate-vitest-to-bun.mjs tests`, then `bun scripts/migrate-vitest-to-bun.mjs --check tests`. Expected: exit 0, and `rg "from ['\"]vitest" tests` finds nothing.
- [x] **Step 6: Snapshots.** Convert each vitest `.snap` file to Bun's snapshot format with the same keys and values. `git diff --stat tests/**/__snapshots__` plus a review must show only header and format changes. Then run `CI=true bun test` on the 17 snapshot tests. Expected: PASS, with no "written" snapshots.
- [x] **Step 7:** Delete `tests/vitest.config.js`. Run `cd tests && bun run test:junit`, then `bun __baseline__/verify-test-counts.mjs ../test-results.xml`. Record the failing files. Expected: they match clusters A–H, and the counts gate passes except where files error at load time.
- [x] **Step 8:** Commit: `test: convert suite from vitest to bun test (codemod)`.

### Task 5: Fix clusters B and D (mock factories, timers, hangs)

**Files:** the cluster B and D test files listed above. Runtime code is touched only if the root cause is there.

- [x] **Step 1:** For each file, follow superpowers:systematic-debugging and write down the root cause.
  - **Partial factory** (`Export named X not found`): spread the actual module into the factory, e.g. `vi.mock(spec, async () => ({ ...(await import(spec + "?actual")), …overrides }))`, where `spec` is relative to the test file. Alternatively, add the missing named exports as `vi.fn()`.
  - **`importOriginal`**: replace with `() => import("<same spec>?actual")` inside the factory.
  - **`vi.importActual(spec)`** → `import(spec + "?actual")` at the call site.
  - **`vi.doUnmock(spec)`** → `vi.mock(spec, async () => import(spec + "?actual"))`.
  - **Timeouts and the worker crash**: find what never resolves (a fake timer that never advances, a real socket, an `await` on an unflushed microtask). Fix the cause; don't raise the timeout.
- [x] **Step 2:** Run `cd tests && bun test --parallel <each file>`. Expected: PASS, with the test count ≥ baseline.
- [x] **Step 3:** Commit per logical group: `test: fix partial module mocks for bun`, then `test: fix timer/hang issues under bun`.

### Task 6: Fix cluster A (SQLite handle held on Windows)

**Files:**
- Create: `tests/helpers/tempDataDir.js`
- Modify: the cluster A test files. Change `src/lib/db/driver.js` only if `close()` isn't reachable through the wrapped adapter.

**Interfaces:**
- Produces: `useTempDataDir(prefix: string) → { get dir(): string }`. It registers `beforeEach`/`afterEach` that create the dir, set `DATA_DIR`, `delete global._dbAdapter` and `vi.resetModules()`. Teardown awaits `global._dbAdapter?.instance?.close()`, then calls `fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })` and restores `DATA_DIR`.

- [x] **Step 1: Write the failing test** in `tests/unit/temp-data-dir.test.js`: open the DB through `@/lib/db/index.js` with a write in it. After teardown, the directory no longer exists, and no `-wal`/`-shm` file is left.
- [x] **Step 2:** Run it on Windows. Expected: FAIL with `EBUSY`.
- [x] **Step 3:** Implement the helper. If the null-byte wrapper (`withNullByteSafeParams`) hides `close`, forward `close` in `src/lib/db/driver.js` (a runtime fix).
- [x] **Step 4:** Move each cluster A file's own temp-dir lifecycle onto `useTempDataDir`. In `request-details-tab.test.js`, replace the direct `better-sqlite3` import with `bun:sqlite` (`Database` from `"bun:sqlite"`) and keep the same assertions.
- [x] **Step 5:** Run the cluster A files on Windows and Linux (WSL or CI). Expected: PASS.
- [x] **Step 6:** Commit: `test: shared temp DATA_DIR helper that releases sqlite before cleanup`.

### Task 7: Bun-native outbound HTTP (cluster C)

**Files:**
- Modify: `open-sse/utils/proxyFetch.js`, `open-sse/translator/concerns/image.js`, `src/lib/network/proxyTest.js`, `src/app/api/proxy-pools/[id]/test/route.js`
- Test: the cluster C files, plus new `tests/unit/image-fetch-ip-pin.test.js`
- Modify: root `package.json` (remove `undici` if no import remains)

**Interfaces (signatures kept, so callers don't change):**
- `proxyAwareFetch(url, options = {}, proxyOptions = null) → Promise<Response>`. A proxy goes through Bun `fetch(url, { ...options, proxy: normalizedProxyUrl })`; direct calls use `fetch(url, options)`. A forced fresh socket is `fetch(url, { ...options, keepalive: false })`.
- The undici backstop (`UNDICI_BACKSTOP_MS` headers and body timeout) becomes an `AbortSignal.any([callerSignal, AbortSignal.timeout(UNDICI_BACKSTOP_MS)])` with the same constant and the same error classification.
- `getDispatcher` / `getDirectDispatcher` / `getFreshRetryDispatcher` / `resetDirectDispatchersForTests`: remove them, or keep them as thin compatibility exports only if non-test callers exist. Check with `rg "getDispatcher|getDirectDispatcher|getFreshRetryDispatcher" src open-sse`.
- Image fetch with an SSRF pin: `fetch(\`${url.protocol}//${pinnedHost}${url.pathname}${url.search}\`, { headers: { Host: url.host }, tls: { serverName: url.hostname }, redirect: "manual", signal })`. `pinnedHost` is the validated IP, bracketed for IPv6. Over plain `http:`, only the `Host` header is needed.

- [x] **Step 1: Write the failing tests** in `tests/unit/image-fetch-ip-pin.test.js`:
  - `"connects to the validated IP, not a re-resolved one"`: stub `node:dns/promises` so validation returns `127.0.0.1`. Start a local `Bun.serve` on 127.0.0.1 that records `req.headers.get("host")`. Expect the fetch to hit that server and `host` to equal the original hostname and port.
  - `"does not follow redirects"`: the local server returns 302 to a private URL. Expect `null`.
  - `"rejects when the validated IP is private"`: this assertion already exists in `ssrf-image-security`; keep it.
- [x] **Step 2:** Run it. Expected: FAIL. Then run the existing cluster C files; they fail as recorded in the probe.
- [x] **Step 3:** Implement the interfaces above.
- [x] **Step 4:** For tests that asserted undici mechanics (dispatcher eviction cap, `dispatcher.close` on eviction, the agent backstop), rewrite them to assert the same user-visible behaviour:
  - A hung upstream is aborted after `UNDICI_BACKSTOP_MS`, using fake timers.
  - A stale-socket error is retried exactly once with `keepalive: false`.
  - A proxied call passes `proxy: <normalized url>`.
  - Proxy URL normalisation is unchanged.

  List each `old → new` mapping in the PR description.
- [x] **Step 5:** Run all cluster C files plus `rg "from ['\"]undici" src open-sse`. Expected: tests PASS, and no undici imports remain. If none remain, remove `undici` from the root `package.json`.
- [x] **Step 6:** Commit: `feat(network): bun-native outbound fetch, proxy and SSRF IP pin`.

### Task 8: Clusters E and F (driver and runtime assumptions, `node --test`)

**Files:** `tests/unit/db-driver-chain.test.js`, `system-ca-trust.test.js`, `headroom-detect.test.js`, `provider-pricing-minimax-m3.test.js`. Convert `tests/unit/custom-server-h2c.test.cjs` → `tests/unit/custom-server-h2c.test.js`.

- [x] **Step 1:** Find each root cause.
  - `db-driver-chain`: under Bun the chain picks `bun:sqlite` first. Make the test assert the Bun branch explicitly (driver `"bun:sqlite"` is selected, and the null-byte wrapper is applied). Plan 2 trims the chain to `bun:sqlite` only, so don't add new Node-branch assertions.
  - `system-ca-trust`: it exercises `custom-server.js`'s CA-store swap. Find out what Bun does with `NODE_EXTRA_CA_CERTS` and the system CA store, then assert the Bun-equivalent behaviour. The custom-server parts get deleted in Plan 2, so keep them as they are until then.
  - `headroom-detect` and `provider-pricing-minimax-m3`: debug them. `headroom-detect` is a known Windows fail, so check it on Linux before changing anything.
- [x] **Step 2:** Convert the h2c `.cjs` test to ESM `bun:test`. It must still spawn `custom-server.js` and assert the same responses, so record it under its new name in `test-counts.json` with its `node --test` case count. If it needs a Next build, run it in CI after the build step.
- [x] **Step 3:** Run them. Expected: PASS on Linux. Windows-only failures go into `known-fails.txt` only if they're already there under their old names.
- [x] **Step 4:** Commit: `test: bun-run driver, CA and h2c tests`.

### Task 9: CI on Bun, interim Next-on-Bun build, and docs

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: root `package.json` (`engines.bun`, a `test` script)
- Modify: `CLAUDE.md` (Commands and Tests sections)
- Modify: `docs/superpowers/plans/2026-11-22-bun-rewrite-p1-test-suite.md` (tick boxes)

- [x] **Step 1:** Change `test.yml` as follows. Leave the `pull_request` trigger and the `push: branches: [main, staging]` trigger as they are, and leave `docker-publish.yml` and `production-image.yml` untouched.
  - Replace `setup-node` with `oven-sh/setup-bun@v2` and `bun-version: 1.4.4`.
  - Install with `bun install --frozen-lockfile` at the root and in `tests/`.
  - Run, from `tests/`: `CI=true bun test --parallel --reporter=junit --reporter-outfile=../test-results.xml`.
  - Then run `git diff --exit-code -- tests` (fails if Bun wrote or changed any snapshot), `bun tests/__baseline__/verify-no-regression.mjs test-results.xml`, `bun tests/__baseline__/verify-test-counts.mjs test-results.xml`, `bun scripts/migrate-vitest-to-bun.mjs --check tests`, `bunx --bun eslint .` (a plain `bunx eslint` follows ESLint's `node` shebang), and `bun run build:bun` (interim Next-on-Bun build) with the existing standalone budget check.
- [x] **Step 2:** Root `package.json`: add `"engines": { "bun": ">=1.4.4" }` and `"test": "cd tests && bun test --parallel"`. Generate `bun.lock` with `bun install`. The root `package-lock.json` stays until Plan 4, because the Dockerfile still uses `npm ci`.
- [x] **Step 3:** Update the test commands in `CLAUDE.md`: no `npx vitest`, `bun test` from `tests/`, the junit verify scripts, and the rule "after merging `main`, run `bun scripts/migrate-vitest-to-bun.mjs tests`".
- [x] **Step 4:** Open the PR to `staging`. CI must be green:
  - `bun test` exits 0
  - the counts gate passes
  - the codemod check passes
  - eslint passes
  - `build:bun` passes
- [x] **Step 5:** Commit: `ci: run tests on bun 1.4.4 for staging`.

---

## Done when

- [x] `cd tests && CI=true bun test --parallel` exits 0 on Linux CI. On Windows, `verify-no-regression.mjs` reports no regressions. Evidence: the CI `Test` workflow on the staging push of 2ea3c4b8 succeeded. Local Linux (Docker `oven/bun:1.4.4`): 4021 tests, 3962 pass, 58 skip, 1 todo, 0 fail. Windows: 0 fail, and the known-fails list went from 25 entries to 0.
- [x] `verify-test-counts.mjs` passes: every baseline file has at least its vitest count. Evidence: `verify-test-counts.mjs` passes; 431 files are at or above the frozen vitest baseline (72f4923f). Deletions are recorded in the `deleted` map, and the skip/todo baseline is frozen.
- [x] `rg "vitest|node --test|setup-node" -g '!docs/**' -g '!CHANGELOG.md'` finds nothing on `staging`. Evidence: the only remaining hits are allowed ones: `scripts/migrate-vitest-to-bun.mjs` and its test plus CI and CLAUDE.md references to it, baseline tooling and data that names vitest as its source, `cli/package.json` `node --test` (moves to Bun in Plan 4), and the archived `intake-report.md`.
- [x] `rg "from ['\"]undici" src open-sse` finds nothing, and the image-fetch IP-pin tests pass. Evidence: no `from "undici"` in src or open-sse, the `undici` dependency is removed, and `tests/unit/image-fetch-ip-pin.test.js` passes.
- [x] `bun run build:bun` succeeds: the interim app builds and runs on Bun. Evidence: it builds, and the standalone output is 80 MiB against the 140 budget.

## Merge procedure for `main → staging` (until cutover)

`git merge main`, then `bun scripts/migrate-vitest-to-bun.mjs tests`, then run the suite and fix what fails. New test files from `main` get counted automatically from the next merge's CI run. Files already in `test-counts.json` must not lose tests.

## Completion record (2026-11-23)

- Implementation PR: https://github.com/raufimusaddiq/literouter/pull/246, merged as 2ea3c4b8.
- Beyond the plan, on owner instruction: the suite was made fully green; unneeded tests were deleted and recorded; code comments are banned, so reasoning went into ADRs 0052, 0003, 0004, 0006 and 0012; a skip/todo gate and a data-dir CI guard were added.
- Runtime fixes: bun:sqlite finalize-before-close, the h2c single-source body, Bun-native fetch with proxy/backstop/SSRF pin plus a Node fail-closed guard, and request-log prune no longer deleting the session just created.
- For Plan 2: proxy routing and the SSRF pin need Bun (ADR 0003/0004).
- For Plan 2: `FETCH_KEEPALIVE_TIMEOUT_MS` and `proxyDispatchersMaxSize` are inert and should be trimmed.
- For Plan 2: system-ca-trust no longer covers custom-server's CA wiring.
- For Plan 2: the dead exports `kiroToClaudeNonStreaming` and `formatPxpipeLog` await an owner decision.
- Merge procedure: after `main → staging`, run `bun scripts/migrate-vitest-to-bun.mjs tests` and `bun scripts/migrate-vitest-to-bun.mjs --snapshots`.
