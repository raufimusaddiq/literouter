# Architecture decisions

Code comments are banned. Non-obvious decisions live here, one short bullet each: the rule, why, and `Where:`. Only decisions that would bite an engineer who reads the code but not this file belong here. If a test pins the behaviour, the test is the record.

- [security.md](security.md): client IP and local trust, auth, API keys, SSRF
- [server-runtime.md](server-runtime.md): Bun.serve lifecycle, system CA, packaging, Docker, deploy
- [outbound.md](outbound.md): patched fetch, proxies, relay pools, stale sockets
- [streaming.md](streaming.md): timeouts, stall watchdogs, SSE framing
- [routing.md](routing.md): account fallback, combos, chatCore, token refresh
- [translator.md](translator.md): format translation, Claude cache and cloaking, thinking, Responses, Gemini, RTK
- [models-usage.md](models-usage.md): token accounting, capabilities, catalog, probes, quota
- [pricing.md](pricing.md): rate rows, zero and unpublished rates, IDR-only vendors, adding a rate
- [providers.md](providers.md): per-provider quirks and OAuth flows
- [storage.md](storage.md): SQLite, connections, usage persistence
- [dashboard.md](dashboard.md): SPA build, router, hydration
- [cli.md](cli.md): launcher, tray, autostart
- [testing.md](testing.md): runner, Bun test quirks, lean-test rules

Add a decision to the matching file; do not create numbered ADRs.
