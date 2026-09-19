# Startup minimization (Phase 4)

## What changed

`src/shared/services/initializeApp.js` previously statically imported the tunnel,
MITM, MCP bridge, and MITM-alias modules. Those imports ran on every server boot
regardless of profile, so the non-retained subsystems were always initialized.

They are now lazy-loaded through cached accessors, and the minimal profile
returns early from heavy startup:

```text
[InitApp] minimal profile: skipping tunnel/tailscale/MITM startup
```

What the minimal profile still starts, because it is retained:

- provider connection cleanup,
- quota auto-ping (only when configured),
- background OAuth token refresh.

What it no longer starts or even loads:

- Cloudflare tunnel manager + watchdog,
- Tailscale manager + funnel recovery,
- network-change monitor,
- MITM manager, DNS restore, and MITM alias cache sync,
- MCP stdio/SSE bridges.

The modules remain importable for the routes that use them, so rollback is a
config flip (`MINIMAL_PROFILE=false`) rather than a redeploy.

## Verification

| Check | Result |
| --- | --- |
| Static imports of non-retained modules | 0 (was 4) |
| Container boot | healthy |
| `/api/health` | 200 |
| Retained pages (`/dashboard`, `usage`, `quota`, `providers`) | 200 |
| `/v1/chat/completions` | 200 |
| `/v1/responses` | 200 |
| `/v1/messages` | 200 |

## Memory

| Container | Idle RSS |
| --- | --- |
| Production `9router` | 112 MiB |
| Staging `literouter-staging` | 85 MiB |

Staging also carries a smaller dataset, so this is directional rather than a
like-for-like sizing result.

## Observed behavior worth noting

A failed upstream (mock container removed mid-test) correctly locked the account
for 30 s with `lastError=[502] ... EAI_AGAIN`. Subsequent requests returned 503
with `reset after Ns` until the cooldown expired, after which all three
transports returned 200 again. This is the documented finite cooldown path
working as designed, not a regression from the lazy-loading change.
