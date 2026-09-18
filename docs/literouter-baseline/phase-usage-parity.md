# Usage and Quota parity evidence (staging, live)

## Seeded traffic

Six requests through a mock Generic Provider covering all three ingress
transports (3x `/v1/chat/completions`, 2x `/v1/responses`, plus a messages
request), all HTTP 200.

## Persisted Usage data

`usageHistory` recorded every request with the full field set the Usage contract
needs:

```json
{
  "timestamp": "2026-09-18T18:47:04.919Z",
  "provider": "openai-compatible-chat-ab9d0c7c-...",
  "model": "test-model",
  "endpoint": "/v1/responses",
  "promptTokens": 11,
  "completionTokens": 5,
  "cost": 0,
  "status": "ok"
}
```

`usageDaily` aggregation row written in the same transaction (1 row).

## Usage API surface

| Endpoint | Result |
| --- | --- |
| `/api/usage/stats` | totals, byProvider, byModel, tokens, cost |
| `/api/usage/history?days=1\|7\|30` | same aggregate, all windows |
| `/api/usage/chart?days=7` | HTTP 200 |
| `/api/usage/providers` | provider list with resolved node name |
| `/api/usage/request-details?limit=5` | detail rows with provider/model/connectionId |

## Retained dashboard pages under MINIMAL_PROFILE

All returned HTTP 200 with rendered content:

| Page | HTML bytes |
| --- | --- |
| `/dashboard` | 27169 |
| `/dashboard/providers` | 27560 |
| `/dashboard/combos` | 27669 |
| `/dashboard/usage` | 27169 |
| `/dashboard/quota` | 33983 |
| `/dashboard/token-saver` | 30631 |
| `/dashboard/endpoint` | 200 OK |

## Data-path findings

- `saveUsageStats` intentionally skips writes when both token counts are zero.
  The first seed round produced no rows for exactly that reason (mock upstream
  returned no usage block), which is correct behavior, not a regression. The mock
  was given a `usage` block and persistence was confirmed.
- Quota page reads `/api/providers/client` and `/api/usage/<connectionId>`; both
  return 200. There is no `/api/quota` route — earlier 404 was a wrong probe.

## Production dataset reference

## Rendered parity (2026-09-19)

HTTP status codes alone do not prove a page works, so the retained dashboard
pages were driven in a real browser (Playwright, Chromium) against
`literouter-staging`. Each page was checked for rendered text and for uncaught
JavaScript errors.

| Page | Rendered | JS errors |
| --- | --- | --- |
| `/dashboard/providers` | yes | 0 |
| `/dashboard/combos` | yes | 0 |
| `/dashboard/usage` | yes | 0 |
| `/dashboard/quota` | yes | 0 |
| `/dashboard/token-saver` | yes | 0 |
| `/dashboard/endpoint` | yes | 0 |

The sidebar was checked in the same browser session. Non-retained entries
(CLI Tools, Proxy Pools, Console Log, Skills, Translator) are absent from the
rendered navigation, while the retained entries remain. Note the SSR payload
still contains the markup; the client removes it once `/api/settings` reports
`minimalProfile: true`, and the dashboard guard redirects any direct hit, so a
pre-hydration click cannot reach a non-retained page.

Live pages hold an SSE connection open (`/api/usage/stream`), so
`wait_until="networkidle"` never settles — `domcontentloaded` plus a fixed wait
is the correct probe for these routes.

Production `usageHistory` at capture: 39742 rows, 3676452347 prompt tokens,
15455251 completion tokens, 25 `usageDaily` rows. Staging writes the identical
schema, so production data remains readable without migration.
