# Native passthrough smoke test (staging, live)

Verified against `literouter-staging` (port 20129) with a mock upstream
container that records the exact path each request hits.

Generic Provider node configured with all three native transports:

```json
{
  "name": "Mock Multi",
  "prefix": "mockmulti",
  "baseUrl": "http://mockup:8099/v1",
  "transports": ["chat_completions", "responses", "messages"]
}
```

Derived routes (`GET /api/provider-nodes/routes?id=...`):

```json
[
  { "transport": "chat_completions", "format": "openai", "path": "/chat/completions" },
  { "transport": "responses", "format": "openai-responses", "path": "/responses" },
  { "transport": "messages", "format": "claude", "path": "/messages" }
]
```

Results — all HTTP 200, each ingress hitting its own native upstream path:

| Ingress | Upstream path hit | Response marker |
| --- | --- | --- |
| `POST /v1/responses` | `/v1/responses` | `native-responses-ok` |
| `POST /v1/messages` | `/v1/messages` | `native-messages-ok` |
| `POST /v1/chat/completions` | `/v1/chat/completions` | `native-chat-ok` |

Router log for the Responses request confirms no conversion:

```text
POST mockmulti/test-model → openai-compatible-.../test-model · FMT: openai-responses→openai-responses
```

## Native-vs-translated precedence (2026-09-19)

PRD section 23 requires native transport first and translation only when the
provider cannot serve the incoming transport. Both branches were exercised on
the same ingress, against two nodes on the same mock upstream.

Nodes: `mockmulti` advertises all three transports, `mocksingle` advertises only
`chat_completions`. Both have an active connection.

`POST /v1/messages` with `mockmulti/test-model`:

```text
FMT: claude→claude · ACC:Mock Multi Key
```

`POST /v1/messages` with `mocksingle/test-model`:

```text
FMT: claude→openai · ACC:Mock Single Key
```

Both returned HTTP 200. The multi-transport node passed Claude through
unchanged; the chat-only node translated and returned a valid Claude-shaped
response (`content[].type == "text"`, `stop_reason`), proving translation is
still available as a fallback.

## Transport cardinality

`GET /api/provider-nodes/routes?id=` was checked for each advertised set:

| Node | `transports` | Routes returned |
|---|---|---|
| `mocksingle` | `["chat_completions"]` | 1 (`/chat/completions`) |
| `mocktwo` | `["chat_completions","responses"]` | 2 |
| `mockmulti` | all three | 3 (`/chat/completions`, `/responses`, `/messages`) |

One, two, and three native transports all configure and resolve correctly
(PRD section 21).

## Unknown-field preservation

The Responses request included `forward_compatible_field: "keep-me"`. The mock
upstream recorded these body keys:

```json
["model", "input", "stream", "forward_compatible_field"]
```

The unknown field survived routing intact — required by PRD section 7 when no
token-saving transform is enabled.

## Regression found and fixed by this test

Live traffic initially returned HTTP 500 (`Cannot read properties of undefined
(reading 'merged')`). Cause: the settings cache initialised only `raw`, so
`merged` was never populated on a fresh process. Fixed in
`src/lib/db/repos/settingsRepo.js`; covered by
`tests/unit/settings-cache.test.js`.
