# ADR-0056: Lean tests and the hygiene check

- Status: Accepted
- Date: 2026-11-23
- Origin: owner request in Plan 5 Task 11 ("makes rule for the test not bloated and decluttered in the finishing")

## Context

The suite grew to about 510 test files during the Bun rewrite. Part of that was real coverage, but part was bloat: per-version copy files for the same model family, one-case-per-file copies of a status or provider variant, tests that asserted helpers defined inside the test itself, fixtures left behind by the Node era, and migration-only scaffolding. Task 11 Step 2 merged and deleted what it could prove redundant. Without a standing rule the suite grows back the same way, because the cheapest way to cover a new variant is to copy a neighbouring file.

The per-file case-count guard (`verify-test-counts`, with its frozen baseline and `deleted` map, ADR 0052 D8, D9 and D19) was retired in Task 10. It could only stop a count from going down, which made declutter impossible without editing the baseline, and it said nothing about growth by copy-paste.

## Decisions

### D1. Rules for every test

One behaviour per test. Cases that share a body and differ only in data are written as one `it.each` or `describe.each` table whose columns are the real per-case differences, so adding a model version or provider id is a new row. Shared setup lives only in `tests/helpers/` (and the existing per-suite `helpers/` directories) and is deleted in the PR that removes its last user. Every fixture is referenced by at least one test or script. Every test file has an assertion, and no test only asserts helpers it defines itself or restates the implementation with the same literal and branching.

### D2. Deleting or merging tests needs an assertion proof

With the count guard gone, a PR that merges or deletes tests names the cases involved and shows that every expectation survives (before and after assertion lists). Reviewers hold the PR to that.

### D3. A cheap CI check enforces what a machine can decide

`scripts/check-test-hygiene.mjs --check` scans `tests/` and `cli/test/` and exits 1 on:
- a fixture file (any file under a `fixtures` or `__fixtures__` directory) whose basename no other test, script or workflow file mentions; a README mention does not count; `tests/parity/fixtures` and `tests/parity/expected` are exempt by directory;
- a helper (non-test `.js` or `.mjs` under a `helpers` directory) that no file imports by specifier;
- a `*.test.js` file with no assertion (`expect(`, `expect.assertions`, `assert`, `toMatchSnapshot`);
- an exact duplicate test title within one file, scoped by enclosing `describe`; titles from `.each` tables and template strings are ignored.

A fixture loaded through a directory listing is declared in `DIR_LOADED_ALLOW` inside the script with a reason. The list is empty today, and an entry without a reason is a review failure.

## Alternatives considered

- **Keep the count guard.** Rejected: it blocks every legitimate merge, needs a baseline edit per change, and does not constrain growth.
- **No rule, rely on review.** Rejected: the bloat accumulated under review, and the unreferenced-file and no-assertion cases are free to detect.
- **Detect duplicate bodies mechanically.** Rejected for now: deliberate repetition produces false positives. One-behaviour and no-restating stay review rules.

## Consequences

- The suite should shrink in lines and stay flat in coverage; adding a variant is a table row.
- A new fixture or helper needs a user in the same PR, or CI fails.
- A false positive needs an entry in `DIR_LOADED_ALLOW` with a reason, which is visible in review.
- The check reads about 600 files with no process spawn and runs in well under a second.

**Where:** `scripts/check-test-hygiene.mjs`; `tests/unit/test-hygiene.test.js`; `.github/workflows/test.yml`; `CLAUDE.md` ("Tests stay lean")
