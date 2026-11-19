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
