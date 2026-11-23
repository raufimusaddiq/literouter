# Bun cutover evidence

Evidence for the spec §8 cutover gates of the Bun rewrite
(`docs/superpowers/specs/2026-11-22-bun-rewrite-design.md`), produced by Plan 5
(`docs/superpowers/plans/2026-11-22-bun-rewrite-p5-cutover.md`). One section per
gate. A gate counts only with its evidence recorded here.

| Item | Value |
| --- | --- |
| `GATED_MAIN_SHA` | `90ac4b20952622cc42186e3f316d0e093ed425cf` |
| Node baseline image | `ghcr.io/raufimusaddiq/literouter-production:production-90ac4b20952622cc42186e3f316d0e093ed425cf` |
| `staging` head under test | `92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc` |
| Staging image | `ghcr.io/raufimusaddiq/literouter-staging:staging-92d1aa5ed090f04e497fc18c871cd25b2f6eb3bc` (amd64 + arm64) |
| Soak start (Asia/Jakarta) | pending owner |
| Switch hour (Asia/Jakarta) | pending owner |

## Preconditions (Task 0)

Checked on `staging` at `92d1aa5e`, 2026-11-23.

| Check | Result |
| --- | --- |
| Plans 1–4 merged; no open PR into `staging` | yes: #254 `[bun-rewrite p4] complete` merged; `gh pr list --base staging --state open` empty |
| `staging` CI green | yes: Staging Image runs 45156357915 (#254) and 45154897177 (#253) success; CodeQL success |
| `compose.production.yml`: no `node -e` healthcheck, no `NODE_OPTIONS` | yes: healthcheck is `env BUN_BE_BUN=1 /app/literouter -e …`; `NODE_OPTIONS` removed |
| `mem_limit`, `9router-data:/app/data`, `9router` alias on `idx-public` unchanged | yes: `mem_limit: 768m`, volume and alias unchanged vs `main` |
| Staging image pushed for the head, both arches | yes: `docker buildx imagetools inspect` lists `linux/amd64` and `linux/arm64` |
| `Dockerfile` has no `node` stage | yes: `bun` builder, `alpine` runner |
| `package.json` has no `next`; `bun run build`, `bun run compile` exist | yes |

## Merge and freeze

| Item | Value |
| --- | --- |
| `main` commits not in `staging` at gating | 0 (`git log origin/staging..origin/main` empty), so no merge PR was needed |
| Freeze rule | soft freeze (plan Task 1): until the cutover PR merges, `main` takes only fixes production needs; any commit touching `src/ open-sse/ cli/ package.json Dockerfile compose.production.yml` re-runs Parity and Security |
| Drift check before the cutover PR | `git diff --stat 90ac4b20952622cc42186e3f316d0e093ed425cf origin/main -- src open-sse cli package.json Dockerfile compose.production.yml` (empty = no re-run) |
| Suite gate | pending |

## Parity

| Item | Result |
| --- | --- |
| pending | |

## Performance

| Metric | Node | Bun | Rule | Verdict |
| --- | --- | --- | --- | --- |
| pending | | | | |

## Security

| id | Result | Detail |
| --- | --- | --- |
| pending | | |

## Dashboard walk-through

| Page / check | Result | Note |
| --- | --- | --- |
| pending | | |

## CLI matrix

| OS | Install | Scenario | Result |
| --- | --- | --- | --- |
| pending | | | |

## Soak

| Item | Result |
| --- | --- |
| pending | |

## Rollback rehearsal

| Item | Result |
| --- | --- |
| pending | |

## Cutover

| Item | Result |
| --- | --- |
| pending | |

## Release

| Item | Result |
| --- | --- |
| pending | |
