# Model catalog report - 2026-11-20

Ticket T-28. Facts come from official vendor pages only (read 2026-11-20; page text treated as data). Prices are USD per 1M tokens, Standard tier, short context, as `input / output / cache read / cache write`. `0*` = not published, explicit 0 plus `TODO(source)` in `pricing.js`. "Unconfirmed" = the provider's own catalog could not be checked, so no id was added.

## Added or priced

| Vendor | Model id | In LiteRouter before? | Added to providers | Price in / out / cache read / write | Official source | Checked |
|---|---|---|---|---|---|---|
| OpenAI | gpt-6.2-astra | no | openai | 8 / 40 / 0.40 / 10 | https://developers.openai.com/api/docs/models/gpt-6.2-astra , https://developers.openai.com/api/docs/pricing | 2026-11-20 |
| OpenAI | gpt-6.2-sol | no | openai | 2 / 10 / 0.10 / 2.50 | https://developers.openai.com/api/docs/models/gpt-6.2-sol | 2026-11-20 |
| OpenAI | gpt-6.1-terra | no | openai | 1 / 5 / 0.05 / 1.25 | https://developers.openai.com/api/docs/pricing | 2026-11-20 |
| Google | gemini-4-carbon | antigravity tiers, commandcode only | gemini (API key) | 2 / 10 / 0.10 / 0* (intro to 2026-11-30; 4 / 20 / 0.20 from 2026-12-01) | https://ai.google.dev/gemini-api/docs/pricing , https://aistudio.google.com/docs/models/gemini-4-carbon | 2026-11-20 |
| Google | gemini-4-argon | no | gemini | 2 / 10 / 0.10 / 0* (same intro schedule) | https://aistudio.google.com/docs/models/gemini-4-argon | 2026-11-20 |
| Google | gemini-4-neon | no | gemini | 3 / 15 / 0.15 / 0* | https://aistudio.google.com/docs/models/gemini-4-neon | 2026-11-20 |
| Google | gemini-4-hydrogen | no | gemini | 1.50 / 7.50 / 0.075 / 0* | https://aistudio.google.com/docs/models/gemini-4-hydrogen | 2026-11-20 |
| Tencent | hy4-preview | yes (codebuddy-cn, kenari, opencode-go), unpriced | none new | 0.834 / 2.501 / 0.042 / 0* ("To Be Discontinued") | https://www.tencentcloud.com/document/product/1300/78937 | 2026-11-20 |
| Tencent | hy4, hy4-flash | no | none (see unconfirmed) | hy4 0.834 / 2.501 / 0.042 / 0*; hy4-flash 0.07 / 0.281 / 0.003 / 0* | https://www.tencentcloud.com/document/product/1300/78937 , /78934 | 2026-11-20 |
| Cerebras | qwen-3.8-27b, gpt-oss-120b | yes, unpriced | none new | 0.99 / 1.49 and 0.35 / 0.75; cache 0* | https://inference-docs.cerebras.ai/models/qwen-3.8-27b.md , /models/openai-oss.md | 2026-11-20 |
| Groq | openai/gpt-oss-120b | yes, unpriced | none new | 0.15 / 0.60; cache 0* | https://console.groq.com/docs/models | 2026-11-20 |

Capabilities rows (`capabilities.js`):
- gpt-6.2-astra, gpt-6.2-sol: 1,050,000 context, 128,000 max output, vision, reasoning (effort `none` rejected), function calling.
- gpt-6.1-terra: same window assumed from the gpt-6 pattern. Its own model page was not read, so it is marked `TODO(source)`.
- gemini-4 (`*gemini-4*` pattern): 1,048,576 context, 65,536 default max output, text/image/video/audio/PDF in, `gemini-level` thinking, tools, search grounding.
- hy4, hy4-flash: 1M context, 64k output, vision, reasoning, tools. hy4-preview has no image understanding on the official list, and the existing codebuddy-cn row is left as is.

## Existing rows corrected (old -> new, in / out / cache read)

| Model | Old | New | Source |
|---|---|---|---|
| gpt-6-astra | 5 / 25 / 0.50 | 10 / 50 / 1.00 (write 12.50) | OpenAI pricing page |
| gpt-6-sol | 1 / 5 / 0.10 | 2 / 10 / 0.20 | OpenAI pricing page |
| gpt-6-luna | 0.05 / 0.25 / 0.005 | 0.10 / 0.50 / 0.01 | OpenAI pricing page |
| gpt-5.6-sol | 2 / 10 / 0.20 | 4 / 20 / 0.40 | OpenAI pricing page; a promo until 2026-11-30 is mentioned and which row it affects is unclear |
| gpt-5.6-terra | 1 / 6 / 0.10 | 2 / 12 / 0.20 | OpenAI pricing page |
| gpt-5.6-luna | 0.10 / 0.60 / 0.01 | 0.20 / 1.20 / 0.02 | OpenAI pricing page |
| gpt-5, gpt-5.1, gpt-5-mini cache read | 0.625 / 0.625 / 0.125 | 0.125 / 0.125 / 0.025 | OpenAI pricing page |
| gpt-5.5, 5.5-pro, 5.4, 5.4-pro/mini/nano, 5.2-pro | pattern fallback | exact rows | OpenAI pricing page |
| deepseek-flash, deepseek-v4.1-flash, deepseek-v4-flash | 0.14 / 0.28 / 0.0028 | 0.15 / 0.60 / 0.003 (off-peak; peak is 2x) | https://api-docs.deepseek.com/quick_start/pricing |
| deepseek-v4-pro | 0.435 / 0.87 / 0.003625 | 0.66 / 1.98 / 0.022 (off-peak) | same |
| glm-5 | 1 / 4 / 0.50 | 1 / 3.2 / 0.2 | https://docs.z.ai/guides/overview/pricing |
| glm-4.7 | 0.75 / 3 / 0.375 | 0.6 / 2.2 / 0.11 | same |
| glm-4.6 | 0.5 / 2 / 0.25 | 0.6 / 2.2 / 0.11 | same |
| glm-4.6v | 0.75 / 3 / 0.375 | 0.3 / 0.9 / 0.05 | same |
| glm-5.3, 5.3-flash, 5.2, 5.1 | pattern fallback (1 / 4 / 0.5) | 1.4 / 4.4 / 0.26; 0.15 / 0.50 / 0.03; 1.4 / 4.4 / 0.26; 1.4 / 4.4 / 0.26 | same |
| grok-4.7, 4.6, 4.5, 4.3 | pattern fallback (0.5 / 2) | 2 / 6 / 0.50; 2 / 6 / 0.50; 2 / 6 / 0.30; 1.25 / 2.50 / 0.20 (<200k prompt) | https://docs.x.ai/docs/models |

Verified and unchanged: every Claude row (fable-5-2, fable-5.1/5, opus-5-5, sonnet-5-5, sonnet-5, haiku-5-5 up to a 100K prompt) against https://platform.claude.com/docs/en/about-claude/pricing. MiniMax-M3 0.30 / 1.20 / 0.06 against https://platform.minimax.io/docs/pricing/overview. gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.6-flash list rate (3.8 and 3.6 flash are 0.75 / 3.75 / 0.075 through 2026-12-31).

## Unconfirmed or not added

| Vendor | Model id | Why not added |
|---|---|---|
| OpenAI | gpt-6.2-* on codex | The pricing page's Codex category lists only gpt-5.3-codex and no model page mentions Codex, so Codex is unconfirmed. |
| Google | gemini-4-neon / hydrogen / argon on antigravity, vertex, gemini-cli | Their own catalogs were not checked. Vertex's pricing page lists Gemini 4, but its model ids were not read. |
| Tencent | hy4, hy4-flash on codebuddy-cn, kenari, opencode-go, tencent | These catalogs were not checked. The `tencent` provider targets api.hunyuan.cloud.tencent.com, not the TokenHub host the pricing page covers. |
| DeepSeek | deepseek-v4-flash, deepseek-v4-flash-vision-exp | The vendor retired both and serves them as V4.1-Flash. They stay in the catalog and are priced at the Flash rate. It is not my call to drop them. |
| Alibaba | qwen4-max (1.5 / 4.5), qwen3.7-plus, qwen3.8-flash | No provider here is confirmed to serve Model Studio's own ids. The pricing page was partly truncated. |
| Moonshot | kimi-k3.1-pro | The price tables did not render in the fetched copy, so the existing kimi-k3 rate is neither confirmed nor changed. K2 retires by the end of 2026-12. |
| MiniMax | MiniMax-M3.1-Flash (0.15 / 0.60 / 0.015) | The provider catalog is unconfirmed. |
| Xiaomi MiMo | all | The pricing page returned no content. |
| Mistral | mistral-large-4 (0.70 / 2.10 / 0.07) | Whether `mistral-large-latest` maps to it is not stated. |
| Groq, Cerebras, NVIDIA NIM, Meta Llama | newer ids | Groq and Cerebras list no vision, tool or cache data. NIM shows slugs without ids or prices. The Meta page redirected to another host and was not followed. |

## Defaults
No default or fallback model changed. No vendor retired a current default.

## Pricing backfill (T-29)

Audit on this branch after T-28: 771 chat models, 167 unpriced and 7 explicit 0/0 before; 0 unpriced after. `tests/unit/pricing-coverage.test.js` now fails CI if any chat/llm catalog model has no pricing row (allowlist `tests/unit/fixtures/pricing-coverage-allow.json` is empty). Audit: `bun tests/__baseline__/report-pricing-coverage.mjs`.

After: 34 backfilled rows carry a sourced rate (plus the o3 canonical row); 132 backfilled rows are explicit `0` with `TODO(<provider>)` because the provider publishes no usable per-token USD price; the 7 pre-existing zeros are unchanged. Zero means "cost not tracked", not "free", unless the source says free. Read 2026-11-20.

### Sourced rates (USD per 1M: input / output / cache read)

| Provider | Model | Rate | Source |
|---|---|---|---|
| openai, kilocode | o3 | 2 / 8 / 0.50 | https://developers.openai.com/api/docs/pricing; https://ai-gateway.kilo.ai/api/v1/models |
| cloudflare-ai | @cf/meta/llama-3.2-1b-instruct | 0.027 / 0.201 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/meta/llama-3.2-3b-instruct | 0.051 / 0.335 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/meta/llama-3.1-8b-instruct-fp8-fast | 0.045 / 0.384 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/meta/llama-3.1-8b-instruct-awq | 0.123 / 0.266 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/mistralai/mistral-small-3.1-24b-instruct | 0.351 / 0.555 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/meta/llama-3.1-70b-instruct-fp8-fast | 0.293 / 2.253 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/meta/llama-3.3-70b-instruct-fp8-fast | 0.293 / 2.253 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cloudflare-ai | @cf/qwen/qwq-32b | 0.66 / 1 / 0 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| cohere | command-r-plus-08-2024 | 2.5 / 10 / 0 | https://cohere.com/pricing (legacy pricing, existing customers) |
| fireworks | accounts/fireworks/models/llama-v3p3-70b-instruct | 0.9 / 0.9 / 0 | https://docs.fireworks.ai/serverless/pricing (">16B parameters" tier; model not listed by name) |
| mistral | codestral-latest | 0.3 / 0.9 / 0.03 | https://docs.mistral.ai/inference/pricing (Codestral) |
| ollama | gpt-oss:120b | 0.15 / 0.6 / 0.014 | https://ollama.com/pricing (pay-as-you-go cloud) |
| openai | o3 | 2 / 8 / 0.5 |  |
| siliconflow | inclusionAI/Ling-flash-2.0 | 0.14 / 0.57 / 0 | https://siliconflow.com/models/ling-flash-2-0 |
| together | meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8 | 0.27 / 0.85 / 0 | https://www.together.ai/models/llama-4-maverick |
| venice | venice-uncensored-1-2 | 0.2 / 0.9 / 0 | https://docs.venice.ai/overview/pricing |
| venice | zai-org-glm-5 | 1 / 3.2 / 0.2 | https://api.venice.ai/api/v1/models (cache_input) |
| venice | llama-3.3-70b | 0.7 / 2.8 / 0 | https://docs.venice.ai/overview/pricing |
| venice | mistral-small-3-2-24b-instruct | 0.09375 / 0.25 / 0 | https://docs.venice.ai/overview/pricing |
| kimchi | nemotron-3-ultra-fp4 | 0.6 / 3.6 / 0 | https://docs.kimchi.dev/docs/model-apis-pricing (cache rate unpublished) |
| opencode-go | longcat-2.0 | 0.3 / 1.2 / 0.006 | https://opencode.ai/inference/go/v1/models (provider catalog cost field) |
| opencode-go | hy3 | 0.14 / 0.58 / 0.035 | https://opencode.ai/inference/go/v1/models |
| opencode-go | muse-spark-1.2-contributor | 0.1 / 0.2 / 0.002 | https://opencode.ai/inference/go/v1/models; matches https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data) |
| opencode-go | muse-spark-1.3-contributor | 0.1 / 0.2 / 0.002 | https://opencode.ai/inference/go/v1/models; matches https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data) |
| perplexity-agent | perplexity/sonar | 0.25 / 2.5 / 0.0625 | https://docs.perplexity.ai/docs/agent-api/models.md (tool/search fees extra) |
| bazaarlink | auto:free | 0 / 0 / 0 | https://bazaarlink.ai/api/v1/models (free router, prompt/completion "0") |
| kilo-gateway | kilo-auto/free | 0 / 0 / 0 | https://api.kilo.ai/api/gateway/models (free router) |
| kilo-gateway | nvidia/nemotron-3-ultra-550b-a55b:free | 0 / 0 / 0 | https://api.kilo.ai/api/gateway/models (listed 0 / 0) |
| morph | morph-v3-large | 0.9 / 1.9 / 0 | https://morphllm.com/pricing |
| morph | morph-v3-fast | 0.8 / 1.2 / 0 | https://morphllm.com/pricing |
| muse | muse-spark-1.2-contributor | 0.1 / 0.2 / 0.002 | https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data) |
| muse | muse-spark-1.3-contributor | 0.1 / 0.2 / 0.002 | https://dev.meta.ai/docs/pricing-rate-limits (contributor mode, Meta may train on data) |
| byteplus | seed-2-0-pro-260328 | 0.5 / 3 / 0.1 | https://docs.byteplus.com/docs/en/modelark/model-pricing.md (Standard tier, 0-128K prompt; 128-256K is 1.00 / 6.00 / 0.20) |
| byteplus | seed-2-0-code-preview-260328 | 0.5 / 3 / 0.1 | https://docs.byteplus.com/docs/en/modelark/model-pricing.md (Standard tier, 0-128K prompt; 128-256K is 1.00 / 6.00 / 0.20) |

### Explicit 0 with TODO

| Provider | Model | Reason |
|---|---|---|
| cerebras | zai-glm-4.7 | model deprecated and removed from the public list; no current price |
| cerebras | llama-3.3-70b | model deprecated and removed from the public list; no current price |
| cerebras | llama-4-scout-17b-16e-instruct | model deprecated and removed from the public list; no current price |
| cohere | command-r-08-2024 | current pricing page lists neither version |
| cohere | command-a-03-2025 | current pricing page lists neither version |
| gemini | gemma-4-31b-it | Gemini API lists Gemma 4 as free tier only, paid tier not available |
| groq | llama-3.3-70b-versatile | Groq models page shows Contact Sales only |
| groq | meta-llama/llama-4-maverick-17b-128e-instruct | shut down 2026-03-09 per console.groq.com/docs/deprecations |
| hyperbolic | meta-llama/Llama-3.3-70B-Instruct | no official price page readable; only aggregator figures found |
| hyperbolic | meta-llama/Llama-3.2-3B-Instruct | no official price page readable; only aggregator figures found |
| hyperbolic | NousResearch/Hermes-3-Llama-3.1-70B | no official price page readable; only aggregator figures found |
| mistral | mistral-large-latest | docs price Mistral Large 4 (0.70 / 2.10 / 0.07) but do not state that -latest maps to it |
| mistral | mistral-medium-latest | alias target (Medium 3.5) not in the pricing table; deprecated 2026-10-31 |
| nebius | meta-llama/Llama-3.3-70B-Instruct | tokenfactory price page unreadable; only third-party figures found |
| nvidia | nvidia/nemotron-3.5-lightning-30b-a3b | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | nvidia/nemotron-3.5-bolt-e4b | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | nvidia/nemotron-3-nano-omni-30b-a3b-reasoning | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | nvidia/nemotron-3-ultra-550b-a55b | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | poolside/laguna-xs-2.1 | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | meta/llama-guard-4-12b | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | nvidia/riva-translate-4b-instruct-v2 | build.nvidia.com is a free prototype endpoint, no per-token price |
| nvidia | meta/llama-3.3-70b-instruct | build.nvidia.com is a free prototype endpoint, no per-token price |
| siliconflow | openai/gpt-oss-120b | page lists 0.05 / 0.45 with cache read 0.075 (above input), inconsistent; not adopted |
| together | meta-llama/Llama-3.3-70B-Instruct-Turbo | only an unconfirmed 1.04 / 1.04 on a page that does not tie it to the Turbo id |
| venice | hermes-3-llama-3.1-405b | absent from Venice catalog and pricing page (retired) |
| api-airforce | gpt-oss-120b | api.airforce prices are subscription credits (1 credit = 1 cent), not a USD list; unit inferred |
| api-airforce | gpt-oss-20b | api.airforce prices are subscription credits (1 credit = 1 cent), not a USD list; unit inferred |
| cline | kwaipilot/kat-coder-pro | not in https://api.cline.bot/api/v1/ai/cline/models; no rate published |
| clinepass | cline-pass/mimo-v2.5 | flat-fee ClinePass subscription; docs give no rate for this MiMo V2.5 id |
| clinepass | cline-pass/mimo-v2.5-pro | flat-fee ClinePass subscription; docs give no rate for this MiMo V2.5 id |
| cursor | default | plan-based auto routing, no published per-token price |
| github | goldeneye-free-auto | Copilot plan-based free/auto router, no per-token price |
| opencode-go | ox-alpha-free | absent from the provider live catalog (only mimo-v2.6 listed); no rate published |
| opencode-go | mimo-v2.5 | absent from the provider live catalog (only mimo-v2.6 listed); no rate published |
| opencode-go | mimo-v2.5-pro | absent from the provider live catalog (only mimo-v2.6 listed); no rate published |
| opencode | muse-spark-1.2-contributor-free | id absent from the Zen/Go catalogs (-free/alpha id); no rate published |
| opencode | muse-spark-1.3-contributor-free | id absent from the Zen/Go catalogs (-free/alpha id); no rate published |
| opencode | union-alpha | id absent from the Zen/Go catalogs (-free/alpha id); no rate published |
| perplexity-web | pplx-auto | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-sonar | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-gpt | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-gemini | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-sonnet | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-opus | web-session/subscription provider, no per-token price |
| perplexity-web | pplx-nemotron | web-session/subscription provider, no per-token price |
| perplexity | sonar-pro | Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card |
| perplexity | sonar-reasoning-pro | Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card |
| perplexity | sonar-deep-research | Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card |
| perplexity | sonar | Sonar chat completions rerouted to the Agent API (2026-09-27); official docs carry no Sonar rate card |
| perplexity-agent | nvidia/nemotron-3-super-120b-a12b | id not in the Agent API model list; no rate published |
| qoder | ultimate | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | performance | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | efficient | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | lite | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | qmodel_38max | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | qmodel_latest | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | qmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | qfmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | kmodel_latest | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | kmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | gmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | gfmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | dmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | dfmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| qoder | mmodel | credit-based subscription (tier multipliers, not dollars), no per-token price |
| bazaarlink | mimo-v2.5-pro | absent from https://bazaarlink.ai/api/v1/models |
| bazaarlink | mimo-v2.5 | absent from https://bazaarlink.ai/api/v1/models |
| bazaarlink | nemotron-3-super-120b-a12b | absent from https://bazaarlink.ai/api/v1/models |
| kilo-gateway | nvidia/nemotron-3-super-120b-a12b:free | id absent from https://api.kilo.ai/api/gateway/models; no rate published |
| kilo-gateway | kwaipilot/kat-coder-pro-v2.5:free | id absent from https://api.kilo.ai/api/gateway/models; no rate published |
| kilo-gateway | kilo-auto/frontier | catalog lists -1/-1 (variable price of the routed model) |
| kilo-gateway | kilo-auto/balanced | catalog lists -1/-1 (variable price of the routed model) |
| morph | morph-qwen35-397b | id not on https://morphllm.com/pricing (only newer ids listed) |
| morph | morph-minimax27-230b | id not on https://morphllm.com/pricing (only newer ids listed) |
| morph | morph-qwen36-27b | id not on https://morphllm.com/pricing (only newer ids listed) |
| morph | morph-dsv4flash | id not on https://morphllm.com/pricing (only newer ids listed) |
| poolside | poolside/laguna-s-2.1 | only an OpenRouter-endpoint price (0.10 / 0.20 / 0.01) was found, not a Poolside price page |
| poolside | poolside/laguna-xs-2.1 | Poolside docs/blog publish no rate |
| poolside | poolside/laguna-m.1 | Poolside docs/blog publish no rate |
| kenari | agnes-2-0-flash:free | id absent from kenari.id/v1/models; no published price |
| kenari | agnes-2-5-flash:free | id absent from kenari.id/v1/models; no published price |
| kenari | agnes-3-0-flash:free | id absent from kenari.id/v1/models; no published price |
| kenari | gemma-4-31b-it | id absent from kenari.id/v1/models; no published price |
| kenari | gpt-oss-120b | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 630 / 3500 / 63), no USD rate; unit unclear, not converted |
| kenari | gpt-oss-20b | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 630 / 2700 / 65), no USD rate; unit unclear, not converted |
| kenari | hy3 | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2700 / 11000 / 270), no USD rate; unit unclear, not converted |
| kenari | hy3:free | id absent from kenari.id/v1/models; no published price |
| kenari | laguna-s-2-1:free | id absent from kenari.id/v1/models; no published price |
| kenari | laguna-xs-2-1:free | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 1200 / 2500 / 1200 (listed free)), no USD rate; unit unclear, not converted |
| kenari | mimo-v2-5 | id absent from kenari.id/v1/models; no published price |
| kenari | mimo-v2-5-pro | id absent from kenari.id/v1/models; no published price |
| kenari | mimo-v2-5:free | id absent from kenari.id/v1/models; no published price |
| kenari | mistral-medium-3-5:free | id absent from kenari.id/v1/models; no published price |
| kenari | muse-spark-1-2 | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 20000 / 80000 / 2000), no USD rate; unit unclear, not converted |
| kenari | muse-spark-1-2-contributor | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2000 / 4000 / 200), no USD rate; unit unclear, not converted |
| kenari | muse-spark-1-2-contributor:free | id absent from kenari.id/v1/models; no published price |
| kenari | muse-spark-1-3 | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 20000 / 80000 / 2000), no USD rate; unit unclear, not converted |
| kenari | muse-spark-1-3-contributor | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 2000 / 4000 / 200), no USD rate; unit unclear, not converted |
| kenari | muse-spark-1-3-contributor:free | id absent from kenari.id/v1/models; no published price |
| kenari | nemotron-3-super-120b-a12b | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 1700 / 8400 / 170), no USD rate; unit unclear, not converted |
| kenari | nemotron-3-super-120b-a12b:free | id absent from kenari.id/v1/models; no published price |
| kenari | nemotron-3-ultra-550b-a55b | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 12000 / 75000 / 1200), no USD rate; unit unclear, not converted |
| kenari | nemotron-3-ultra-550b-a55b:free | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 12000 / 75000 / 4200 (listed free)), no USD rate; unit unclear, not converted |
| kenari | nex-n2-5-pro:free | id absent from kenari.id/v1/models; no published price |
| kenari | north-mini-code:free | listed free with null rates at kenari.id/v1/models |
| kenari | step-3-7-flash | kenari.id/v1/models publishes IDR only (micro_idr_per_1m_tokens; in/out/cache-read raw ÷1e6 = 4200 / 24000 / 840), no USD rate; unit unclear, not converted |
| kenari | step-3-7-flash:free | id absent from kenari.id/v1/models; no published price |
| byteplus | seed-2-0-mini-260215 | page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied |
| byteplus | seed-2-0-lite-260228 | page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied |
| byteplus | gpt-oss-120b-250805 | page prices only the -260428 snapshot (or no gpt-oss row); a different snapshot rate is not copied |
| codebuddy-cn | hy3 | CodeBuddy is a credit/subscription plan, no per-token price |
| iflow | iflow-rome-30ba3b | no iFlow price page found (plan/free tier) |
| mmf | mimo-auto | free-ai promotional endpoint; no price page found |
| volcengine-ark | Doubao-Seed-2.0-Code | https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated |
| volcengine-ark | Doubao-Seed-2.0-pro | https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated |
| volcengine-ark | Doubao-Seed-2.0-lite | https://docs.volcengine.com/docs/82379/1544106 prices in CNY only (tiered), no USD stated |
| volcengine-ark | Doubao-Seed-Code | not on the official page; only press-quoted launch prices |
| xiaomi-mimo | mimo-x-pro-preview | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-mimo | mimo-x-flash-preview | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-mimo | mimo-v2.5-pro | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-mimo | mimo-v2.5 | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-mimo | mimo-v2-omni | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-mimo | mimo-v2-flash | not on https://mimo.mi.com/docs/en-US/price/pay-as-you-go (v2.5 retired 2026-10-21; only v2.6 listed) |
| xiaomi-tokenplan | mimo-v2.6-pro | Token Plan is quota-based; pay-as-you-go rates do not apply to it |
| xiaomi-tokenplan | mimo-v2.6-flash | Token Plan is quota-based; pay-as-you-go rates do not apply to it |
| xiaomi-tokenplan | mimo-v2.5-asr | ASR billed per audio hour / TTS free for a limited time; no per-token price |
| xiaomi-tokenplan | mimo-v2.5-tts | ASR billed per audio hour / TTS free for a limited time; no per-token price |
| xiaomi-tokenplan | mimo-v2.5-tts-voiceclone | ASR billed per audio hour / TTS free for a limited time; no per-token price |
| xiaomi-tokenplan | mimo-v2.5-tts-voicedesign | ASR billed per audio hour / TTS free for a limited time; no per-token price |
| codebuddy-intl | hy3-preview | CodeBuddy is a credit/subscription plan, no per-token price |
| tencent | hunyuan-turbos-latest | cloud.tencent.com lists only the -vision variants (CNY); no price for this id |
| tencent | hunyuan-t1-latest | cloud.tencent.com lists only the -vision variants (CNY); no price for this id |

Notes for review: Poolside laguna-s-2.1 (0.10 / 0.20 / 0.01 OpenRouter endpoint), Mistral large-latest (Large 4 0.70 / 2.10 / 0.07 alias unconfirmed), Volcengine (CNY tiers), BytePlus mini/lite (only -260428 priced) and kenari (IDR) were deliberately left at 0 rather than guessed.
