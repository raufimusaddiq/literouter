# Repository Guidelines

## Project Structure

- `src/`: Next.js dashboard, API routes, authentication, persistence, and app-side SSE handlers.
- `open-sse/`: provider registry, executors, request/response translators, and token-saving logic.
- `cli/`: separate `9router` launcher package with its own `package.json`.
- `tests/`: Vitest unit, translator, baseline, and optional live-provider tests.
- `public/`: dashboard assets and localized literals.
- `docs/`: architecture, PRD, baseline, and deployment runbooks.

## Build, Test, and Development

Before any heavy command (`npm install`, builds, full test suites, Docker build/pull, migrations), check resource usage and service health first: `uptime`, `free -h`, `df -h /opt/9router /tmp`, active processes, `docker ps`/container health, and the relevant health endpoint. Do not start heavy work when resources are constrained or the target service is unhealthy; report the condition first.

This instance is a production host. Agents, including disposable upstream-intake
agents, must not run local dependency installs, builds, or test suites (focused
tests included). Delegate validation to GitHub CI. The commands below are for
isolated development machines, not this instance.

```bash
cp .env.example .env
npm install
npm run dev                         # Next.js development server
npm run build && npm run start      # production-style local server
npx eslint .                        # lint
cd tests && npm install && npx vitest run
```

Use `npm run cli:pack` to package the CLI. The test suite is independent from the root package. Some known failures and live-provider tests are expected; use the baseline scripts under `tests/__baseline__/` to detect regressions.

## Coding Style

Use plain JavaScript ESM, two-space indentation, and existing `@/*` imports for `src/*`. Prefer small, direct functions. Reuse provider, translator, database, and security helpers before adding new abstractions. Keep provider-specific behavior in the provider/executor layer. Never weaken request validation, peer-IP checks, authentication, or fail-closed behavior.

Use Conventional Commits, for example `fix(translator): preserve tool errors` or `docs: update deployment runbook`. Update `CHANGELOG.md` when the user-visible behavior or published package changes.

## Testing Guidelines

Name tests `*.test.js` or `*.test.cjs`; place unit tests in `tests/unit/` and translator tests in `tests/translator/`. Add the smallest regression test for non-trivial fixes. On this production instance, push the change and let CI run tests and builds; never install or run them locally. Live tests require credentials and must not gate ordinary changes.

## Pull Requests and Deployment

PRs target `main`. Include intent, affected paths, tests run, and operational impact. Follow `docs/literouter-baseline/pr-merge-runbook.md`: merge only with green CI and no blocking Hermes review; do not retrigger queued reviews. Staging is retired. Merges publish an immutable production image; deploy only the merged SHA with `compose.production.yml`, then verify container health and `/api/health`.

Disposable upstream intake must wait for checks and current-head Hermes review.
Repair completed CI failures and blocking findings with real code changes, push,
then wait again. Do not finish at PR creation, bypass gates, retrigger pending
reviews, or delete the workspace before successful deployment. Retain a failed
workspace for retry; the host controller, not untrusted upstream code, owns
GitHub credentials, merge, and deployment.

## Security and Configuration

Keep secrets in `.env`, never commit credentials. Override the default `INITIAL_PASSWORD`. Treat `JWT_SECRET`, `API_KEY_SECRET`, and machine-ID settings as production secrets. Do not trust forwarded client headers outside the approved loopback proxy path.
