# ADR-0057: Dashboard restyle — Route Sheet design system

- Status: Accepted
- Date: 2026-11-23
- Origin: Dashboard restyle (`ui/redesign`), approved by owner on 2026-11-23

## Context

The dashboard's pages, flows, controls, and API calls worked well, but its base look read as a stock admin dashboard (left sidebar, four equal stat cards, card grid, warm cream/indigo accents, and accumulated decorative CSS such as glow keyframes, vibrancy blur, and macOS traffic lights). Four design exploration rounds were rejected:

- Round 1 (quiet): "nothing impressed me".
- Round 2 (loud / Transit / TTY): "so bad", gimmicky, and too far from a restyle.
- Round 3 (futuristic glass): "AI slop".
- Round 4 (anti-slop reskins of the same skeleton): still a usual dashboard.

Round 5 succeeded by changing composition rather than just skinning the stock skeleton: it puts LiteRouter's core domain concept — requests entering, routing through `/v1`, and landing on providers — at the centre of Overview, and carries one disciplined hairline-ruled language across all 16 SPA pages and shared modals without changing behaviour, routes, or APIs.

## Decision

Adopt the **Route Sheet** visual language across `src/web/**` and `src/shared/components/**`:

- Hairline-ruled sections (`line` / `line-strong`) instead of floating shadowed cards; opt-in raised containers (`raise` fill, 1px border) where containment is structurally needed (forms, code blocks, quota groups, modal bodies, topology frame).
- Sticky top bar on desktop (`>= 1360px`), Menu sheet on tablet (`640–1359px`), and thumb-first bottom tab bar + More sheet on phone (`< 640px`).
- Strictly semantic colour: signal yellow (`mark`, `#ffd23f`) means now/current/selected only; green (`ok`) means healthy only; red (`danger`) means failing only; everything else stays neutral cool slate.
- Typography: Schibsted Grotesk Variable (`@fontsource-variable/schibsted-grotesk@5.3.0`, pinned exact) replaces IBM Plex Sans Variable for UI text; JetBrains Mono Variable stays for IDs, models, keys, URLs, ticks, and table figures. Both are self-hosted and emitted as content-hashed `.woff2` assets under `/assets/` rather than base64-inlined in the main CSS bundle, so they cache independently. Because `Bun.build`'s CSS bundler inlines `.woff2` files below its internal size threshold even when `.woff2` is configured with `loader: "file"`, `fontAssets` in `src/web/build.js` intercepts `.woff2` URL resolutions, writes content-hashed files to `<outdir>/assets/`, and rewrites CSS references to `/assets/<stem>-<hash>.woff2`.
- Material Symbols Outlined stays as the icon font, restyled to `'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20` at `18px`, with `fill-1` retired.

**Where:** `src/web/build.js`; `src/web/globals.css`; `src/web/fonts.css`; `src/web/index.html`; `tests/web/build.test.js`; `tests/web/route-sheet-guards.test.js`

## Tokens

Existing CSS custom property names (`bg`, `bg-alt`, `surface`, `surface-2`, `surface-3`, `sidebar`, `border`, `border-subtle`, `text`, `text-main`, `text-muted`, `text-subtle`, `primary`, `primary-hover`, `primary-foreground`, `success`, `danger`, `warning`, `info`, `brand-50`..`brand-900`) are retained and remapped in `:root` (light) and `.dark` (dark) so every unmigrated page shifts into the neutral palette immediately.

New semantic Route Sheet tokens are added in `:root`, `.dark`, and `@theme inline` so both Tailwind utilities and SVG code (`var(--color-mark)`, `var(--color-wire)`, etc.) consume one source of truth:

| Token | Light (`:root`) | Dark (`.dark`) | Role |
|---|---|---|---|
| `--color-bg` | `#f3f4f4` | `#111212` | Page canvas |
| `--color-raise` | `#ffffff` | `#18191a` | Opt-in raised container / overlay fill |
| `--color-line` | `#dfe1e2` | `#25282a` | Hairline divider |
| `--color-line-strong` | `#bfc3c6` | `#3b3f42` | Section top rules and control borders |
| `--color-ink` | `#121314` | `#ecedee` | Primary text and inverted primary fill |
| `--color-muted` | `#50555a` | `#a1a6aa` | Secondary text |
| `--color-faint` | `#62676c` | `#868b90` | Tertiary metadata and axis ticks |
| `--color-bar` | `#3a3e42` | `#50555a` | Default chart bar fill |
| `--color-mark` | `#ffd23f` | `#ffd23f` | Now / current / selected signal fill |
| `--color-mark-ink` | `#121314` | `#111212` | Text on `mark` fill |
| `--color-mark-line` | `#a37a00` | `#ffd23f` | Focus outlines and lit route wires |
| `--color-ok` | `#1d7a46` | `#5fd08a` | Healthy status only |
| `--color-danger` | `#c4242a` | `#f06a6a` | Failing status only |
| `--color-warning` | `#92400e` | `#e0a43a` | Warning status |
| `--color-wire` | `#c9cdd0` | `#3d4246` | Idle route wire |
| `--color-wire-live` | `#6d7378` | `#8a9095` | Recently active route wire |
| `--color-grid` | `#e1e3e5` | `#2a2d30` | Dashed chart grid lines |

Theme switching remains the `.dark` class toggled by `src/store/themeStore.js`. Selection and scrollbar colours are neutral in both themes.

## Glass and shadow rules

- **Glass (`backdrop-filter`):** allowed **only** on the desktop and tablet sticky top bar so scrolling content passes beneath it. Forbidden everywhere else (cards, modals, drawers, toasts, phone tab bar, buttons).
- **Shadows:** allowed **only** on truly floating layers — `Modal`, `Drawer`, menus/popovers, and sheets — via `--shadow-float`. Card shadows (`--shadow-soft`, `--shadow-warm`, `--shadow-elev`, `--shadow-elevated`), glow animations, gradients, shimmer CTAs, vibrancy classes, macOS traffic-light dots, and indigo scrollbars/selections are removed from `src/web/globals.css`. Any legacy class still referenced in source (such as `.landing-grid` on the login page) keeps its class name with a flat style until its page task retires it.
- **Guard test:** `tests/web/route-sheet-guards.test.js` enforces the presence of the Route Sheet tokens, the absence of retired decorative CSS in `globals.css`, and incrementally checks `GUARDED_PATHS` against retired classes (`backdrop-blur`, old shadow vars, `fill-1`, glow animations, old brand radii) as each task migrates components and pages.

## The `ProviderTopology` exception

The owner explicitly asked to keep the `ProviderTopology` animation on the Usage page (electric active edge, travelling packets, powering router node and badge). The "no glow" anti-goal therefore carries one documented exception for the topology's active edge and powering node; it remains strictly enforced everywhere else.

In its dedicated refactor task, `ProviderTopology` moves off hardcoded cyan/green/yellow-300 colours into the Route Sheet signal family (`mark` core, lower-opacity `mark-line` halo, `mark` packets, `wire`/`wire-live` edges, hairline `raise` provider boxes), respects `prefers-reduced-motion` (lit static edges, hidden packets), keeps the chunk lazy, and shares its marching wire-packet motion with Overview's newest-request wire.

## `@ui-sdk/react` verdict

`@ui-sdk/react` was evaluated and **not adopted** (owner agreed):

- Bundle cost: **+58.5 KB gzip** for `Menu` alone and **+73.5 KB gzip** for `Dialog + Menu + Tooltip + Tabs`, measured against a `react` + `react-dom` baseline of **56.5 KB gzip** (more than doubling the framework footprint).
- Maturity: beta API (14 releases).
- LiteRouter's existing in-house `Modal`, `Drawer`, `Tooltip`, and keyboard-navigable menu hook already cover every required interaction without adding heavy UI-kit weight.

## Tailwind kept

Tailwind CSS v4 (`bun-plugin-tailwind`) is **kept** by owner decision (2026-11-23). Tokens are wired into Tailwind through `@theme inline` in `src/web/globals.css`. Moving off Tailwind is out of scope for this restyle and may be evaluated separately later.

## Baseline

Measured on commit `a26989b4` (`feat/route-sheet-foundation` branched from `ui/redesign`) before any Task 1 edits:

- **Initial JS (`tests/web/build.test.js`):** `344,926` bytes (budget: `650 KB` / `665,600` bytes).
- **Main CSS (`dist/app/web/assets/index-2yqr7w01.css`):** `243,099` bytes raw / `107,453` bytes gzip (roughly 115 KB raw was the two base64-inlined `.woff2` fonts).
- **Full test suite (`bun run test`, Windows host):** `4,515` pass, `60` skip, `1` todo, `20` fail, `1` error across `505` files (`18,613` `expect()` calls). Every baseline failure/error is a Windows-host environment test: `tests/unit/deploy-script.test.js` (11 fails, `/bin/bash` path handling), `tests/unit/production-image-retention.test.js` (8 fails, bash script env handling), `tests/unit/system-ca-trust.test.js` (1 fail, missing `openssl` in `$PATH`), and `tests/unit/image-fetch-ip-pin.test.js` (1 error, missing `openssl` in `$PATH`).

## Consequences

- Every subsequent Route Sheet task builds on the token names and Tailwind utilities defined here without introducing ad-hoc hex values or shadow/blur classes.
- Moving text and mono fonts out of base64 data URIs into hashed `/assets/*.woff2` files cuts the main CSS payload substantially and lets browsers cache font files independently across CSS changes.
- Any component or page added to `GUARDED_PATHS` in `tests/web/route-sheet-guards.test.js` is continuously protected against regression to retired glass, glow, shadow, or `fill-1` styles.
