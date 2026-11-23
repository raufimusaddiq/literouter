# ADR-0027: Provider validation and model test probes

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The dashboard validates new provider credentials (`/api/providers/validate`), tests saved connections (`/api/providers/[id]/test`) and runs a per-model "Test" button. These probes must prove authentication without spending quota, without hanging, and without misreporting a healthy-but-slow model as broken. Providers answer bad keys, valid-but-unusable keys and missing models with very different status codes, so each probe encodes provider-specific interpretation.

## Decisions

### D1. Probes prove auth with the cheapest request, not a real generation

Probes send a minimal invalid body or invalid question that triggers a fast 400 without consuming quota or an evaluation. A 400 or 529 means the credential was accepted; only 401/403 (or the provider's equivalent) means the token or key is bad. Cookie-based providers treat any non-401/403 response (200, 400, 429) as a valid cookie. A 400 can also be a model-resolution error with auth passed (agentrouter "no available channel").

**Where:** `src/app/api/providers/[id]/test/testUtils.js`; `src/app/api/providers/validate/route.js`

### D2. Provider-specific status interpretation

xai returns 400 for a bad key and 403 for a valid key with no credit; other providers use 401. A /models endpoint that returns 403 for a valid key lacking list permission means only 401 is invalid. The Vertex raw-key probe treats 404 (model does not exist) as valid and 401 as invalid, using the global endpoint which always 404s for an unknown model and never 401s. Another provider returns 401 for invalid, 200 for valid, 400 for malformed. Synthetic's `/openai/v1/models` answers 200 for any Bearer value, so it cannot reject a bad key and must not be used to validate one. iFlow `getUserInfo` needs the access token as a query parameter, not a header.

**Where:** `src/app/api/providers/validate/route.js`; `src/app/api/providers/[id]/test/testUtils.js`; `tests/unit/synthetic-usage.test.js`

### D3. A missing validateUrl is a config bug, not a bad credential

The registry entry owns the host. A missing `validateUrl` must surface as a configuration error and must not read as "invalid credential".

**Where:** `src/app/api/providers/[id]/test/testUtils.js`

### D4. Warm up one model before parallel model tests; bound probe time

Model tests warm up with the first model so a token refresh happens once, avoiding concurrent refreshes of the same token (a race with rotating tokens). Connection tests carry a 15-second timeout so they cannot hang and exhaust browser or Node connection pools.

**Where:** `src/app/api/providers/[id]/test-models/route.js`; `src/app/api/providers/[id]/test/testUtils.js`

### D5. Model test is a first-token probe

The dashboard model test used to wait for a full generation (stream:false, max_tokens:1024) under a hardcoded 15 s abort. On heavy-tailed providers it reported healthy-but-slow models as broken while the upstream call still completed and was billed. It now streams, resolves on the first token, cancels the rest, and reports a 504 "may be slow" instead of a bare 500 with a raw DOMException. The router forwards upstream lines with endings intact, so SSE boundaries must accept both `\n\n` and `\r\n\r\n`; accepting only `\n\n` read past the first token and timed out on CRLF providers. Reasoning models need a sane token budget (1024, not tiny), and a reasoning-only length-limited response counts as a successful connection (#3010).

**Where:** `src/app/api/providers/[id]/test/testUtils.js`: model ping (`pingModelByKind`); `tests/unit/model-test-first-token-probe.test.js`; `tests/unit/ping-reasoning-models-3010.test.js`

### D6. Test outcomes are recorded per model with a timestamp

Production runs at `LOG_LEVEL=WARN`, so a passing probe leaves no log line and a successful test looks like it never happened. Outcomes are stored as `{ [modelId]: { status: "ok" | "error", error, at } }`, where `at` (epoch ms) is the visible trace of a pass. The error belongs to the model that produced it: a single page-global error string showed one model's failure on another model's row. Updating one model never touches other models' entries.

**Where:** `src/shared/utils/modelTestResults.js`

## Consequences

- Probing with real generations burns quota and bills users for tests.
- Treating 400 or 403 as "bad key" rejects valid credentials (xai without credit, keys lacking list permission).
- Full-generation tests with short fixed timeouts flag healthy slow models as broken.
- Parallel tests without warm-up race on token refresh and invalidate rotating tokens.
- A shared error string or unlogged passes make per-model test results misleading.
