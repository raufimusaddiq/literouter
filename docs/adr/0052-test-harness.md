# ADR-0052: Test harness and configuration

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The test suite in `tests/` is an independent vitest package that imports application code from `src/`. Many modules read environment configuration (such as `DATA_DIR`) when first imported and open the database immediately, and the repository often contains nested git worktrees. These constraints shape how tests must be written and how vitest is configured.

## Decisions

### D1. Tests that set DATA_DIR must import the DB layer dynamically

`DATA_DIR` has to be in place before the DB layer's first import, because paths and the database are resolved at load time. Tests that need an isolated data directory therefore set `process.env.DATA_DIR` first and then use dynamic `import()` for modules that touch the DB; static imports are hoisted above the assignment and would open the real data directory.

**Where:** `tests/unit/commandcode-live-models.test.js`; `tests/unit/zed-live-models.test.js`; `tests/unit/zed-native-auth.test.js`; `tests/unit/model-catalog-scope.test.js`

### D2. Vitest must not scan nested worktrees and must not run live tests in CI

Git worktrees nested under `.claude/` carry their own copies of the test files but lack an installed `node_modules` (open-sse and others), so provider imports fail during collection; vitest excludes `**/.claude/**`. `*.live.test.js` files hit real upstreams and must never gate CI; they are excluded from the default run and invoked by hand, for example `npx vitest run --exclude '' unit/file.live.test.js`.

**Where:** `tests/vitest.config.js`: `exclude` patterns

## Consequences

- Static imports of DB-touching modules in these tests write to or read the developer's real data directory.
- Scanning nested worktrees makes provider imports fail during collection.
- Including live tests in the default run makes CI depend on provider availability and credentials.
