# LiteRouter baseline & measurements

Working notes for the minimalization initiative. Not part of the product
contract; the PRD (`docs/PRD-LITEROUTER-MINIMAL.md`) is authoritative.

Production replacement and HA prerequisites: [production promotion plan](production-promotion-plan.md).

## Phase 1 baseline (production, image `literouter:v0.5.81-kenari-luna`)

| Metric | Value |
| --- | --- |
| Image size | 1027200945 bytes (0.96 GiB), 1.03 GB reported |
| `/app` in container | 648.4 MB |
| `/app/data` | 21.8 MB at capture |
| Idle RSS | 192.1 MiB (512 MiB limit) |
| Idle CPU | ~0.03% |

## Capture references

Production is live, so every count below is a point-in-time capture. Docs cite
the capture id, never a bare number, because the volume keeps growing:

| Capture | Taken (UTC) | usageHistory | usageDaily | requestDetails | Notes |
| --- | --- | --- | --- | --- | --- |
| `live-20260920T0735Z` | 2026-09-20T07:35Z | 50289 | 26 | 1000 | one-shot copy of `9router-data`, `integrity_check = ok` |

Earlier phase documents record the counts they saw at their own capture time
(39733, 39742, 39903, 40154, 40872, 40956 `usageHistory`); those numbers are
superseded by the table above
and are retained only as the evidence for the check that was run.

Rollback reference: `literouter:v0.5.81-kenari-luna` (production), previous
`literouter:v0.5.75-kenari-fix`.

## Hot-path cache measurements

Measured against a copy of the production SQLite dataset (5000 iterations,
`node:sqlite`), comparing the uncached SQLite read against the in-process cache
added on `staging`:

| Read | Uncached | Cached | Change |
| --- | --- | --- | --- |
| provider connections | 46.8 us/op | 12.0 us/op | -74% |
| model combos | 30.7 us/op | 13.9 us/op | -55% |
| settings | 19.4 us/op | ~0 us/op (returns cached object) | -99% |

The first settings attempt cached raw JSON and cloned per call, which measured
*slower* than the SQLite read (46.1 vs 26.1 us/op). It was replaced by returning
the cached merged object, since all callers only read it.

## Staging deployment

`compose.staging.yml`: container `literouter-staging`, port `20129`, isolated
volume `literouter-staging-data`, `MINIMAL_PROFILE=true`,
`REDIS_URL=redis://idx-redis:6379`, `REDIS_KEY_PREFIX=literouter:staging:`.

Redis is cache-only. Production volume and port are never shared.

## Full-suite comparison (baseline vs staging)

Run with `npm --prefix tests test -- --run` in a clean worktree at
`origin-literouter/main` versus the current `staging` branch:

| | Test files | Tests |
| --- | --- | --- |
| `main` baseline | 34 failed \| 223 passed \| 11 skipped (268) | 139 failed \| 2396 passed (2608) |
| `staging` (first check) | 34 failed \| 226 passed \| 11 skipped (271) | 139 failed \| 2401 passed (2613) |
| `staging` (after Phase 4) | 34 failed \| 230 passed \| 11 skipped (275) | 139 failed \| 2424 passed (2636) |
| `staging` (current) | 0 failed \| 238 passed \| 11 skipped (249) | 0 failed \| 2336 passed \| 14 expected fail \| 54 skipped (2404) |

The `34 failed` rows are historical checkpoints recorded before the test suite
was repaired; they are kept to show the progression, not as a current target.

`main` still carries 139 failures across 34 files (e.g.
`windsurf-executor.test.js` registry assertions, `combo-autoswitch.test.js`,
`translator-request-normalization.test.js`). `staging` is now fully green: the
suite was repaired in #20, which restored the live Cursor, Windsurf, Devin, and
Gemini endpoint coverage and fixed the stale assertions instead of deleting
them. `main` must not be treated as the reference any more — use `staging`.

Run the suite from `tests/`, not the repository root. The `@/` path alias is
only configured in `tests/vitest.config.js`, so a root-level run makes those
imports throw, the `catch(() => null)` guards swallow the error, and affected
tests pass without executing anything.

Any future PR must keep the failure set at or below this baseline; comparing
absolute pass counts without a baseline is misleading.

## Storage watch

Docker build cache grew from 3.5 GB to 9.1 GB during the first staging builds
and was pruned back (reclaimed 1.7 GB). Free space on `/` fell 18 GB to 11 GB
before pruning. Re-check before each build-heavy step; build cache is the
driver, not application data.
