# Minimal profile boundary (staging, live)

`MINIMAL_PROFILE=true` hides non-retained product surfaces at the request guard,
not just in the sidebar. Routes remain in the build so rollback is a config
flip rather than a redeploy.

Surfaces that no retained code imports are **deleted** rather than gated; the
hidden list below only carries what is still reachable in the build.

## Deleted

| Surface | PR |
| --- | --- |
| `basic-chat` | #10 |
| `media-providers`, `/v1/audio/*`, TTS voice routes | #11 |
| `cli-tools` (19 API routes), `mitm` page, `mitmAlias` cache | #12 |

## Hidden prefixes

Dashboard: `proxy-pools`, `skills`, `translator`, `pxpipe`.

API: `proxy-pools`, `skills`, `translator`, `headroom`, `mcp`, `tunnel`,
`version/update`, `version/shutdown`.

## Verified live (staging, healthy)

Retained dashboard routes — all HTTP 200:

```text
200 /dashboard
200 /dashboard/providers
200 /dashboard/combos
200 /dashboard/usage
200 /dashboard/quota
200 /dashboard/token-saver
200 /dashboard/endpoint
```

Hidden dashboard routes — all HTTP 307 (redirect to `/dashboard`):

```text
307 /dashboard/proxy-pools
307 /dashboard/skills
307 /dashboard/translator
```

Deleted dashboard routes — HTTP 404 for an authenticated session, because the
route no longer exists to be gated. A deleted path is indistinguishable from a
path that never existed; unauthenticated requests redirect to `/login`, not to
`/dashboard`.

```text
404 /dashboard/basic-chat
404 /dashboard/cli-tools
404 /dashboard/mitm
404 /dashboard/media-providers
```

Hidden APIs — HTTP 404: `proxy-pools`, `tunnel/enable`.

Retained APIs — HTTP 200: `providers`, `combos`, `usage/stats`, `settings`.

All three ingress transports still returned 200 after the boundary change.

## Coverage

`tests/unit/minimal-profile-boundary.test.js` asserts the gate is keyed on
`MINIMAL_PROFILE`, that every non-retained surface is listed, and that no
retained API or ingress path is shadowed.

## Additions (2026-09-19)

Auditing the dashboard route tree against PRD section 18 found a live gap:
`/api/version/update` and `/api/version/shutdown` (the built-in updater and
shutdown installer flows) were still reachable, and are now hidden.

`/dashboard/console-log` was briefly hidden on the same pass, then retained:
it is the only in-browser view of server-side console output, and the retained
Usage/details pages show request records rather than the log stream. Its API
was moved off `/api/translator` (a hidden prefix) to `/api/console-logs` so
hiding the translator playground no longer takes the log stream down with it.

Verified live on `literouter-staging`:

```text
404 /api/version/update
404 /api/version/shutdown
200 /dashboard  /dashboard/providers  /dashboard/combos  /dashboard/usage
200 /dashboard/quota  /dashboard/token-saver  /dashboard/endpoint
200 /dashboard/console-log
```

Deliberately *not* hidden:

- `/dashboard/profile` is a settings client over retained `/api/settings`, and
  is not on the PRD section 18 removal list.
- Fusion (panel + judge) is a combo strategy rendered inside the retained
  Combos page, not a separate surface. Hiding it would break PRD section 21
  ("Combo works"), which outranks the section 18 candidate list.

Retained regression after the change: 34 tests across nine suites pass, and all
three ingress transports still return 200.

## Migration compatibility (PRD section 19)

The minimal profile must load existing 9Router configuration without manual
database editing. Verified by running the current staging image with
`MINIMAL_PROFILE=true` against a copy of the production database:

```text
providers: 3   combos: 4   keys: 5   usage: 40956
health: {"ok":true}
```

Providers, combos, API keys, and usage history all survived unchanged, and the
service booted healthy. No migration step or manual edit was required.
