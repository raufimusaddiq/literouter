# LiteRouter baseline & measurements

Working notes for the minimalization initiative. Not part of the product
contract; the PRD (`docs/PRD-LITEROUTER-MINIMAL.md`) is authoritative.

## Phase 1 baseline (production, image `9router:v0.5.81-kenari-luna`)

| Metric | Value |
| --- | --- |
| Image size | 1027200945 bytes (0.96 GiB), 1.03 GB reported |
| `/app` in container | 648.4 MB |
| `/app/data` | 21.8 MB at capture |
| Idle RSS | 192.1 MiB (512 MiB limit) |
| Idle CPU | ~0.03% |

Data volume at capture: 3 provider connections, 4 combos, 39903 usageHistory
rows, 25 usageDaily rows, 1000 requestDetails rows.

Rollback reference: `9router:v0.5.81-kenari-luna` (production), previous
`9router:v0.5.75-kenari-fix`.

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
| `staging` | 34 failed \| 226 passed \| 11 skipped (271) | 139 failed \| 2401 passed (2613) |

Identical failure count. The 139 failures (34 files, e.g.
`windsurf-executor.test.js` registry assertions, `combo-autoswitch.test.js`,
`translator-request-normalization.test.js`) are pre-existing on `main` and are
not introduced by the LiteRouter work. Staging adds 3 passing test files and 5
passing tests.

Any future PR must keep the failure set at or below this baseline; comparing
absolute pass counts without a baseline is misleading.

## Storage watch

Docker build cache grew from 3.5 GB to 9.1 GB during the first staging builds
and was pruned back (reclaimed 1.7 GB). Free space on `/` fell 18 GB to 11 GB
before pruning. Re-check before each build-heavy step; build cache is the
driver, not application data.
