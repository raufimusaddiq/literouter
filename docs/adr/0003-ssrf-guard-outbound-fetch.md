# ADR-0003: SSRF guard and outbound fetch

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

LiteRouter fetches URLs that callers control: provider-node base URLs, Azure endpoints, Ollama hosts, remote image URLs inside chat requests, and OAuth callback data. Any of these can be pointed at loopback, a LAN host or a cloud metadata address (169.254.169.254). The project centralizes the defence in `src/shared/utils/ssrfGuard.js` and applies a second, stricter guard to remote image fetches in the translator. The trusted local operator is a legitimate exception, because self-hosted nodes (LM Studio, vLLM, ollama) live on the LAN.

## Decisions

### D1. Three-layer guard for caller-supplied URLs

The guard has three layers, each closing a bypass class from issue #3714. `assertPublicUrl` does cheap synchronous literal host/IP checks. `assertPublicUrlResolved` adds DNS resolution so a hostname that merely resolves to a private address (nip.io / sslip.io wildcard DNS, or an attacker domain with an A record of 127.0.0.1) is rejected. `fetchPublic` wraps fetch with manual redirect handling: it never auto-follows, re-validates every hop through `assertPublicUrlResolved`, and is bounded by `maxRedirects` (default 5). Layer 1 alone had real matching bugs, not just missing coverage, which is why the other layers exist. A DNS resolution failure is not treated as an SSRF signal; the subsequent fetch reports its own clearer network error.

**Where:** `src/shared/utils/ssrfGuard.js`: `assertPublicUrl`, `assertPublicUrlResolved`, `fetchPublic`

### D2. Compare the numeric address, not the textual form

IPv6 literals are parsed into eight 16-bit groups and judged by value, so `::ffff:127.0.0.1` and `::ffff:7f00:1` are identical (WHATWG URL parsing normalizes dotted IPv4-in-IPv6 to hex). IPv4-mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`) and deprecated IPv4-compatible (`::a.b.c.d/96`) prefixes have their embedded IPv4 checked against the IPv4 blocklist, in addition to loopback, unspecified, link-local (`fe80::/10`) and unique-local (`fc00::/7`) ranges. Hostnames are also normalized for a trailing dot, because `localhost.` is the same host as `localhost` but slipped past string comparisons.

**Where:** `src/shared/utils/ssrfGuard.js`: the IPv6 group parser, the private-IPv6 check, hostname normalization; `tests/unit/ssrf-guard-hardening.test.js`

### D3. Every caller-supplied URL goes through fetchPublic; the local operator is exempted by allowing the address

Provider-node create, provider-node validate and provider validate all use the same gate. In `providers/validate` the gate sits at the top of the handler, one check for every caller-controlled URL, because guarding each branch (provider node, Azure endpoint, Ollama host) separately kept missing sinks. `fetchPublic` still re-resolves and re-validates each redirect on top of that. Remote callers are blocked from private and metadata hosts. A trusted local operator (decided per request by `isLocalRequest`) reaches LAN nodes by passing `allowPrivate`, which permits the resolved private address; the guard is never skipped. `allowPrivate` is a per-hop decision, so a LAN node that 30x-redirects inside the LAN remains reachable. It never weakens validation for remote callers. `isLocalRequest` depends on the proxy-stamped peer token from `custom-server.js`.

**Where:** `src/app/api/provider-nodes/route.js`, `src/app/api/provider-nodes/validate/route.js`, `src/app/api/providers/validate/route.js` (including the `azureEndpoint` branch); `tests/unit/provider-node-validate-ssrf.test.js`, `tests/unit/provider-validate-ssrf.test.js`

### D4. Remote image fetch: pinned IP, manual redirects, byte cap

The image translator resolves the host once, requires every returned record to be public (defeating multi-A tricks), and fails closed. It pins the connection to the validated IP with a dedicated undici Agent so a second DNS lookup cannot rebind (TOCTOU). It uses `redirect: "manual"` so a public URL cannot redirect to a private one, and stream-reads the body with a hard byte cap, then verifies magic bytes. IPv4-mapped IPv6 is judged by the embedded IPv4; an `::ffff:0:0/96` rule cannot be used because Node's BlockList maps every IPv4 into that range. Failures return null.

**Where:** `open-sse/translator/concerns/image.js`: the reserved-range list, the private-address check, the resolve-once helper, and the remote image fetch function

### D5. A caller-supplied dispatcher must not be overridden

`proxyFetch` bypasses proxy/relay handling when the caller passes its own `dispatcher`. Overriding it would drop the DNS pin from D4 and reopen rebinding.

**Where:** `open-sse/utils/proxyFetch.js`: the patched fetch entry (`options?.dispatcher` branch)

### D6. Bound remote media: size, count and blocked hosts

`MAX_IMAGE_BYTES` (10 MB) rejects larger remote images to prevent memory DoS. `MAX_REMOTE_IMAGES_PER_REQUEST` (20) bounds memory and outbound fan-out, and over-cap requests are rejected with a 400 rather than silently dropping images. `BLOCKED_HOSTS` lists loopback and cloud metadata hosts that remote media fetches must never reach.

**Where:** `open-sse/config/mediaConfig.js`: `MAX_IMAGE_BYTES`, `BLOCKED_HOSTS`, `MAX_REMOTE_IMAGES_PER_REQUEST`

### D7. Allowlist values interpolated into upstream URLs

Kiro AWS regions must match `AWS_REGION_PATTERN` via `assertValidAwsRegion` before being placed in a URL, preventing SSRF through region injection (GHSA-6mwv-4mrm-5p3m). Trae ExchangeToken/GetUserInfo use a hardcoded HTTPS origin allowlist and intentionally ignore the callback's `loginHost`, since a callback attacker could otherwise aim it at internal hosts or cloud metadata. The Gemini `v1beta` route validates model ids against the Gemini charset (matching `sanitizeGeminiFunctionName`) to block path traversal in the upstream URL. Every registry provider id/alias is reserved as a provider-node display prefix so a user node cannot shadow a built-in route.

**Where:** `src/lib/oauth/constants/oauth.js`: `AWS_REGION_PATTERN`, `assertValidAwsRegion`; `src/lib/oauth/providers/trae.js`; `src/app/api/v1beta/models/[...path]/route.js`; `src/app/api/provider-nodes/route.js`

### D8. Never reflect upstream bodies or error text to the client

Raw upstream error text can carry stack traces or internal detail. The Trae executor logs it server-side and returns a short stable message; the Kiro api-key route does not return the upstream response body. Vertex sends raw API keys in the `x-goog-api-key` header, never in the URL, because URLs get logged (service-account and ADC flows use a Bearer token).

**Where:** `open-sse/executors/trae.js`; `src/app/api/oauth/kiro/api-key/route.js`; `open-sse/executors/vertex.js`

### D9. GitLab PAT validation needs the job-token exchange

A GitLab PAT (`pt-...`) must be exchanged for a job token before it can sign anything, so the generic OpenAI-compatible probe in provider validation cannot validate it.

**Where:** `src/app/api/providers/validate/route.js`: the GitLab branch

## Consequences

- Dropping the resolve step or the per-hop redirect check lets wildcard-DNS names and 30x redirects reach metadata and loopback.
- Matching text forms instead of numeric addresses reintroduces bypasses via hex IPv4-mapped IPv6, NAT64 and trailing-dot hostnames.
- Overriding a caller's dispatcher in `proxyFetch`, or resolving the image host a second time, reopens DNS rebinding.
- Skipping the guard for the local operator (instead of passing `allowPrivate`) removes redirect validation for LAN nodes.
- Putting API keys in URLs or echoing upstream bodies leaks credentials and internals through logs and responses.
