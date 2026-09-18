# Minimal profile boundary (staging, live)

`MINIMAL_PROFILE=true` hides non-retained product surfaces at the request guard,
not just in the sidebar. Routes remain in the build so rollback is a config
flip rather than a redeploy.

## Hidden prefixes

Dashboard: `basic-chat`, `cli-tools`, `mitm`, `media-providers`, `proxy-pools`,
`skills`, `translator`, `pxpipe`.

API: `cli-tools`, `media-providers`, `proxy-pools`, `skills`, `translator`,
`headroom`, `mcp`, `tunnel`.

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
307 /dashboard/basic-chat
307 /dashboard/cli-tools
307 /dashboard/mitm
307 /dashboard/media-providers
307 /dashboard/proxy-pools
307 /dashboard/skills
307 /dashboard/translator
```

Hidden APIs — HTTP 404: `cli-tools/all-statuses`, `media-providers`,
`proxy-pools`, `skills`, `tunnel/enable`.

Retained APIs — HTTP 200: `providers`, `combos`, `usage/stats`, `settings`.

All three ingress transports still returned 200 after the boundary change.

## Coverage

`tests/unit/minimal-profile-boundary.test.js` asserts the gate is keyed on
`MINIMAL_PROFILE`, that every non-retained surface is listed, and that no
retained API or ingress path is shadowed.

## Additions (2026-09-19)

Auditing the dashboard route tree against PRD section 18 found two live gaps:

- `/dashboard/console-log` returned 200 in the minimal profile. The page is
  fully served by `/api/translator/console-logs*`, which was already hidden, so
  the page was a dead surface in minimal mode.
- `/api/version/update` and `/api/version/shutdown` (the built-in updater and
  shutdown installer flows, named in PRD section 18) were still reachable.

All three are now hidden. Verified live on `literouter-staging`:

```text
307 /dashboard/console-log
404 /api/version/update
404 /api/version/shutdown
200 /dashboard  /dashboard/providers  /dashboard/combos  /dashboard/usage
200 /dashboard/quota  /dashboard/token-saver  /dashboard/endpoint
```

Deliberately *not* hidden:

- `/dashboard/profile` is a settings client over retained `/api/settings`, and
  is not on the PRD section 18 removal list.
- Fusion (panel + judge) is a combo strategy rendered inside the retained
  Combos page, not a separate surface. Hiding it would break PRD section 21
  ("Combo works"), which outranks the section 18 candidate list.

Retained regression after the change: 34 tests across nine suites pass, and all
three ingress transports still return 200.
