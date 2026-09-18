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
