# LiteRouter System One

## Product requirement

Expose TypeSafe System One through `POST /v1/systemone`, while keeping LiteRouter API-key authentication, provider connection storage, proxy routing, account fallback, health state, and usage logging conventions reusable for future System One providers.

## v1 scope

- Provider: TypeSafe AI.
- Model: `jev-latest`.
- Request: TypeSafe HTTP API body (`state`, `model`, `questions`).
- Response: upstream JSON and HTTP status passed through unchanged.
- Auth: LiteRouter client API key plus a TypeSafe API-key connection configured in Providers.
- UI: System One menu page with a provider/model selector, editable request workspace, response panel, endpoint, setup link, and request example.
- Failure handling: preserve TypeSafe validation errors; rotate configured TypeSafe accounts on auth, rate-limit, overload, network, and server failures.

## Contract

`model: "jev-latest"` is native. `model: "typesafe/jev-latest"` is accepted for consistency with LiteRouter provider/model naming and normalized before upstream dispatch.

TypeSafe questions remain provider-owned. LiteRouter validates only the top-level envelope and leaves primitive validation to TypeSafe.

## Non-goals

- OpenAI Chat Completions or Responses translation.
- Streaming synthesis; TypeSafe returns a structured evaluation response.
- Browser-side TypeSafe keys.
- A custom SDK or second credential store.

## Acceptance criteria

1. `POST /v1/systemone` rejects malformed JSON, missing model/state/questions, and missing LiteRouter API keys when required.
2. A configured TypeSafe connection receives the exact TypeSafe request shape with `Authorization: Bearer <provider key>`.
3. Successful upstream status, headers, and body reach the client.
4. TypeSafe `401`, `429`, and `529` responses remain observable and trigger configured account fallback behavior.
5. TypeSafe appears in a dedicated System One provider list and its connection test does not perform a billable evaluation.
6. Sidebar exposes System One setup/documentation.
7. Future System One providers require a registry entry with `format: "systemone"`, model list, and endpoint; the route handler and workspace need no provider-specific branch.

## Rollout

Configure a TypeSafe API key, test the connection, send one known `noul` or `choice` request, verify the returned answer and usage, then enable client traffic.
