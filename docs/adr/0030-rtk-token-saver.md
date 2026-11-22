# ADR-0030: RTK token saver and Headroom

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The RTK token savers in `open-sse/rtk/` shrink request bodies before they are translated and sent upstream. They include local filters for `tool_result` content, the Headroom compression proxy, the pxpipe library transform, and system-prompt injection (caveman, ponytail). Helper code under `src/lib/headroom` and `src/lib/pxpipe` installs, starts and probes the external pieces. They run in chatCore on the source-format body, before `translateRequest`. Because they touch every request, they must never make a request worse or fail it, and the cost estimates they report must be honest.

## Decisions

### D1. Every saver is fail-open and never grows or empties the input

Any error, panic or timeout returns null (or `{ body: null, summary }` for pxpipe) and leaves the request untouched. The filter layer passes raw output through and warns on stderr. After filtering, the result is never empty and never larger than the input. The compressed-output memo is keyed by length plus sha1 (collision-safe in practice), bounded as an LRU by entries and bytes, and a cached `null` means "filters produced nothing usable, keep the original". Conversations resend the whole history every turn, so without the memo unchanged results would be re-filtered each time. pxpipe's `transformAnthropicMessages` is local CPU work and cannot be aborted, so the code races a timer and discards the result if it loses, and never mutates the input body. The `/api/pxpipe/stop` route drops the in-process module and requests fail open to uncompressed passthrough until started again. The pxpipe event stats are fire-and-forget and never break the request path: the events file size is seeded by one `stat()` and then tracked in memory, so there are no sync fs calls after the first event.

**Where:** `open-sse/rtk/index.js`: result memo and safety check; `open-sse/rtk/applyFilter.js`; `open-sse/rtk/pxpipe.js`: transform budget race; `src/lib/pxpipe/events.js`; `src/lib/pxpipe/loader.js`: transform loader (returns null when unavailable); `src/app/api/pxpipe/stop/route.js`

### D2. Headroom speaks only OpenAI, so other shapes are projected, compressed and copied back

Headroom's `/v1/compress` only understands the OpenAI shape. Claude bodies are translated to OpenAI, compressed, then translated back with 9Router's own translators. Responses-shaped bodies (Codex, #1998) hold items in `body.input`, not `messages`, so `input` is translated to OpenAI, compressed, and translated back, with `input: undefined` passed so the translator rebuilds `input` from the compressed messages instead of returning the original. Kiro's `conversationState.history` and `currentMessage` are projected to OpenAI messages for the proxy and copied back into the original Kiro fields, keeping the provider payload shape intact for Kiro's executor. Credentials never leak: the Headroom proxy route never forwards viewer credentials to a non-loopback host.

**Where:** `open-sse/rtk/headroom.js`: Claude, Responses and Kiro projection branches; `src/app/api/headroom/proxy/[...path]/route.js`: header handling

### D3. pxpipe savings are measured in tokens, not bytes

The transformed body is bigger in bytes (base64 PNGs) but cheaper in tokens, because images bill by pixels (Anthropic: pixels/750) and not by encoded length. The after-estimate is therefore remaining-text tokens plus image tokens, never chars/4 of the new body. Provider-billed usage recorded per request stays the ground truth. Host-specific pieces (install and load) are injected from `src/` through `opts.transform` so `open-sse` stays standalone, and the loader caches the module per process (library mode starts and stops govern the in-process module, not a daemon). It busts the cache per version so repair or upgrade takes effect without a server restart. Installs can take minutes on a cold npm cache, so the install route allows a long duration, drops any previously loaded version so health loads the fresh one, and extends PATH the same way as headroom/detect because packaged or launchd environments often miss the Node bin dirs.

**Where:** `open-sse/rtk/pxpipe.js`: after-estimate computation; `src/lib/pxpipe/loader.js`; `src/lib/pxpipe/install.js`; `src/app/api/pxpipe/install/route.js`

### D4. System-prompt injection gates on format label and turn shape, never writes `systemPrompt` for Kiro

Claude and Gemini own a dedicated system field, yet their bodies also carry `messages[]` or `contents[]`, so injection decides by format label before the shape sniff. Anthropic rejects a "system" role inside `messages[]`. A top-level `systemPrompt` is deliberately not written. The kiro.dev gateway answers any body carrying it with 400 `{"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}`. The Kiro translator stopped emitting it in v0.5.59, but this injector kept adding it back, so every `kr/` model failed whenever an RTK prompt was active. For the same reason the Kiro shape is detected by turn shape and not by the old `systemPrompt` marker.

**Where:** `open-sse/rtk/systemInject.js`: `injectSystemPrompt` and the Kiro branch

### D5. Headroom process management uses the right interpreter and a closed set of install arguments

Headroom needs Python 3.10 or newer. `python3`, `python3.13` and `python` can point at different environments, so detection prefers the interpreter that can also see the installed `headroom-ai`, so dashboard probes and installs act on the same interpreter as the CLI. The candidates are probed most specific first: the python next to the headroom binary, then full paths from `EXTRA_BINS`, then bare names. If `headroom-ai` is not installed anywhere, it falls back to the first version-eligible candidate (needed for the initial install). The pip install string is built from a closed set (`HEADROOM_COMPRESSION_EXTRAS`), a fixed `['proxy', ...requested]` list, so caller input cannot poison it and there is no shell interpolation. Proxy flags follow headroom's defaults: `[code]` AST compression is off by default, so `--code-aware` turns it on, and `[ml]` (Kompress) is on by default, so `--disable-kompress` turns it off.

**Where:** `src/lib/headroom/detect.js`: Python discovery; `src/lib/headroom/process.js`: proxy flags builder, install command

### D6. Small rules in the autodetector and filters

Build-output detection runs before the porcelain check, which prevents cargo "Compiling" output being misdetected as git status. `.env` (dotenv) is intentionally excluded from the noise-dirs list while a Python legacy virtualenv is included. The runtime config accepts the legacy `9router` spelling alongside the product name LiteRouter so existing clients keep working.

**Where:** `open-sse/rtk/autodetect.js`; `open-sse/rtk/constants.js`: `LS_NOISE_DIRS`; `open-sse/config/runtimeConfig.js`

## Consequences

- A saver that throws, grows the body or returns empty text breaks working requests. Keep every path fail-open with a null return.
- Writing `systemPrompt` into Kiro bodies makes every Kiro model return 400 while an RTK prompt is active.
- Estimating pxpipe savings by bytes reports negative savings and misleads users, and an uncancelled CPU transform stalls requests.
- Passing user-controlled strings to pip, or probing a different Python than the CLI uses, installs or detects Headroom in the wrong place.
- Forwarding viewer credentials to a non-loopback Headroom host leaks them.
