# Dashboard restyle: Route Sheet

Status: approved by the owner 2026-11-23 (with phone navigation added at their request)
Branch: `ui/redesign`, from `origin/staging`
Mock: `opus-route.html` (owner-picked, round 5). Screenshots are attached to the PR.

## Intent

The owner likes the dashboard's pages, flows, information and features. They dislike the base design because "it just looks like a usual dashboard". Four rounds of mockups were rejected:

- Round 1, quiet: "nothing impressed me".
- Round 2, loud: "so bad".
- Round 3, futuristic glass: "AI slop".
- Round 4, anti-slop reskins of the same layout: still a usual dashboard.

What separated the accepted mock is that it changes the composition, not just the skin. It drops the stock skeleton (sidebar, chart card, four stat tiles, two tables) for a layout built from the one thing only LiteRouter does: a request enters, passes through `/v1`, and lands on a provider.

This is a restyle. Every route, page, flow, action, API call and piece of data stays.

## Goals

- **One visual language across all 16 SPA pages and the shared modals**, in light and dark, at desktop, tablet and 390px.
- **Overview gets the signature "routes" band.** Recent requests are wired through a `/v1` hub to the providers that served them, and the newest request's path is lit.
- **The other pages adopt the language:** hairline-ruled sections instead of floating cards, a sentence of big numbers instead of stat tiles where a page has KPIs, signal yellow reserved for "now/current", and green only for healthy status.
- **No behaviour change.** Routes, data fetching, store usage, API calls and keyboard/a11y behaviour stay the same or improve.

## Non-goals

- No new features. In particular: no global search or ⌘K, no new data on any page, no new endpoints.
- No changes to `src/server/`, `open-sse/`, API routes, build packaging or CI, except what the SPA build strictly needs (a new font package).
- No `@ui-sdk/react`. The owner accepted the measured verdict (+58–74 KB gzip, beta API).
- No swap of the icon font. `material-symbols` stays and is restyled.

## Anti-goals

The work fails, even if it technically works, if any of these happen:

- It reintroduces the stock dashboard skeleton on Overview: four equal stat cards, or a sidebar plus card grid.
- Glass, glow, gradients, purple/indigo, or a cream ground with a terracotta accent appear.
- Colour turns decorative. Yellow means "now/current/selected"; green means healthy; red means failing. Nothing else is coloured.
- A page loses a control, a column, a state or a route.

## Approaches considered

1. **Reskin the existing skeleton** (Dispatch Slip, Relay Ledger). Lowest risk, but the owner already rejected it as "a usual dashboard".
2. **Route Sheet: change the composition and keep the data.** *Picked by the owner.*
3. **Full redesign with new IA** (Transit, TTY). Rejected in round 2 as gimmicky, and too far from a restyle.

## Design decisions (as decided)

### Tokens

- **Keep the token names.** Remap the existing `--color-*` tokens in `src/web/globals.css` (`bg`, `bg-alt`, `surface`, `surface-2/3`, `sidebar`, `border`, `border-subtle`, `text-main`, `text-muted`, `primary*`, `success/danger/warning/info`, the brand scale) to the new palette. All 16 pages shift in step one without touching page code.
- **Add new tokens:**
  - `--color-mark` and `--color-mark-ink`: signal yellow for now/current/selected.
  - `--color-mark-line`: a darker yellow for lines on light.
  - `--color-wire` and `--color-wire-live`: route wires.
  - `--color-grid`: dashed chart grid.
- **Dark theme** (the owner's daily theme):

  | Token | Value |
  |---|---|
  | bg | `#111212` |
  | raise | `#18191a` |
  | line | `#25282a` |
  | line-strong | `#3b3f42` |
  | ink | `#ecedee` |
  | muted | `#a1a6aa` |
  | faint | `#868b90` |
  | bar | `#50555a` |
  | mark | `#ffd23f` |
  | ok | `#5fd08a` |
  | wire | `#3d4246` |
  | wire-live | `#8a9095` |
  | grid | `#2a2d30` |

- **Light theme:**

  | Token | Value |
  |---|---|
  | bg | `#f3f4f4` |
  | raise | `#ffffff` |
  | line | `#dfe1e2` |
  | line-strong | `#bfc3c6` |
  | ink | `#121314` |
  | muted | `#50555a` |
  | faint | `#62676c` |
  | bar | `#3a3e42` |
  | mark | `#ffd23f` |
  | mark-line | `#a37a00` |
  | ok | `#1d7a46` |
  | wire | `#c9cdd0` |
  | wire-live | `#6d7378` |
  | grid | `#e1e3e5` |

- **Danger:** dark `#f06a6a`, light `#c4242a`. **Warning:** dark `#e0a43a`, light `#92400e`.
- **Remove decorative leftovers** from `globals.css`: shadow tokens on cards, `bg-hero-gradient`, `bg-vibrancy`, `traffic-lights`, `btn-cta` shimmer/glow, `border-glow`, `pulseGlow`, and the indigo scrollbar and selection colours. A class still referenced in source keeps its name and gets a flat style.
- **Theme mechanism unchanged:** the `.dark` class from `themeStore`, mapped through `@theme inline`.

### Type

- **Text:** Schibsted Grotesk (`@fontsource-variable/schibsted-grotesk`, exact version pinned, self-hosted like Plex today). It replaces IBM Plex Sans.
- **Mono:** JetBrains Mono stays, used for IDs, models, keys, URLs, axis ticks and table figures.
- **Scale:** page title 30/600 (24 at 390px); section title 16/600; big figures 34–44/600 with proportional numerals; body 14; meta 12–12.5. Tabular numerals in tables and anything that updates.
- **Case:** sentence case everywhere, no tracked uppercase labels.

### Shell (`DashboardLayout`, `Sidebar`, `Header`)

- **Replace the left sidebar with a sticky top bar** (52px):
  - Contents: the mark and wordmark, then all 10 nav items in their 4 groups separated by short vertical dividers, then on the right the theme toggle, language and the existing header menu.
  - The active item gets ink text plus a 2px yellow underline.
  - Glass is allowed here only: a translucent bar with `backdrop-filter: blur(14px)`, so content scrolls under it. Nowhere else.
- **Tablet (640–1359px):** the top bar keeps the mark, the current page's name and the right cluster. A "Menu" button opens the navigation sheet (below) with all 10 items.
- **Phone (< 640px), thumb-first** (the owner asked that phone navigation be user friendly):
  - **Top bar (48px):** the mark, then the current page's name (truncated, never wrapping), then the theme toggle and the header menu. The language switch moves into the sheet.
  - **Bottom tab bar** (56px plus `env(safe-area-inset-bottom)`), fixed, opaque `raise` fill with a 1px top rule and no blur:
    - Five equal targets: Overview, Providers, Usage, Endpoint & Key ("Keys" as its short label), and More.
    - Each target is an outline icon (Material Symbols, 22px) over a 11–12px label. The full touch area is at least 48px tall.
    - The active tab gets an ink label and icon plus a 2px yellow bar on its top edge. The others are muted.
    - On a page that isn't one of the four (Combos, System One, Quota, Token Saver, Console Log, Settings), "More" shows as active and the sheet marks the current page.
  - **"More" opens a bottom sheet**, sliding up from the bottom edge and within thumb reach:
    - Contents: a drag handle, a title "All pages", and the 4 groups (Operate, Route, Observe, System) with every one of the 10 items as 48px rows. Each row has an icon and its full label, and the current page is marked with the yellow edge and ink text. The language switch and Logout come last.
    - Height: up to 85% of the viewport, scrolling inside itself.
    - Closing: tapping the backdrop, the close button, Escape, a downward swipe on the handle, or picking a page all close it. The page scroll position is kept.
    - Focus moves into the sheet and is trapped there, the body doesn't scroll behind it, and focus returns to "More" on close. It has `role="dialog"` and `aria-modal`, with the title as its label.
    - Under reduced motion, the slide becomes an instant show.
  - **Page content** gets bottom padding equal to the tab bar plus the safe area, so nothing hides under it. Toasts sit above the tab bar.
  - **Fixed controls:** any fixed or sticky page control (save bars, floating actions) sits above the tab bar.
- **One list feeds every view.** The top bar, tablet sheet, phone tab bar and phone sheet all read one nav list. Each item has `label`, `shortLabel`, `href`, `icon`, `group` and `primary` (the 4 phone tabs).
- **Labels and order:** nav items keep today's labels, hrefs and order (`Sidebar.js` arrays). Move the arrays to a shared module so the top bar and the sheet read one list.
- **Header.js:**
  - Its page-title logic stays; titles render in the page's title row, not in a second bar.
  - Breadcrumbs (the provider detail page) render above the title row in 12.5px muted.
  - The mobile-only header bar is replaced by the top bar.
- **Logo:** the new mark (two input dots wired to one yellow output dot, from the mock) replaces the black tile. The "Workspace online" footer card goes away; Overview carries "Route plane online", and the information isn't lost.
- **Content:** max width 1376px, centred, 32px gutters (16 at 390px).

### Base components (`src/shared/components`)

- **Card:**
  - No shadow and no rounded floating box by default. A section is a 1px top rule (`line-strong`) with its title row, then content.
  - Keep the `title/subtitle/icon/action/padding` props.
  - Add an opt-in `variant="raised"` (1px border, radius 8, `raise` fill) for content that must read as a container: forms, code blocks, quota groups.
  - `Card.Row` and `Card.ListItem` become hairline rows; row actions stay visible on focus.
- **Button:**
  - 32px tall (36 for `lg`), radius 6, 1px `line-strong` border, transparent.
  - `primary` is inverted ink (ink fill, bg text).
  - `danger` is a red outline, filled only inside confirm dialogs.
  - `success` maps to the primary style with no green fill.
  - Press: `translateY(1px)`. No shadows.
- **Input/Select:** 36px, radius 6, 1px `line-strong` border, `raise` fill. Focus is a 2px `mark-line` outline.
- **Toggle:** on is ink, not a brand colour.
- **Badge:** a dot plus text by default (Ready = green dot + green text). Tinted pills only for counts. No saturated fills.
- **SegmentedControl:** a 1px track; the active segment is an inverted ink fill (as in the mock's range switch).
- **Modal/Drawer:**
  - `raise` surface, 1px border, radius 10; one real shadow allowed, because they float. Backdrop `rgba(0,0,0,.5)` with no blur.
  - Remove the traffic-light decoration (`showTrafficLights` becomes a no-op and the prop stays accepted).
- **Tooltip:** small `raise` box, no arrow.
- **Pagination:** text buttons.
- **Toasts** (`DashboardLayout`): `raise` box with a 1px border, a 3px status-colour left edge, and no blur.
- **Material Symbols:** default `wght 300`, `opsz 20`, size 18; no `fill-1` on the active nav item.
- **HeaderMenu:** add keyboard support with arrow keys, Home/End, Escape (return focus) and Tab (close). Reuse the `KeyRowMenu` pattern, extracted into one small hook both menus use.

### Overview (`DashboardOverview.js`), the signature page

- **Title row:**
  - "Overview".
  - Endpoint group: the URL in mono, then "Protected"/"Open" status, then Copy. One bordered group, as today's behaviour.
  - On the right, "Updated hh:mm" and Refresh.
- **Traffic band:**
  - The four 24h figures become one line of big numbers with muted units ("4,783 requests · 469.5M tokens in · 3.2M out · ~$51.38 estimated cost") with the period switch on the right.
  - Then the requests chart: dashed grid, bars in `bar`, the current bucket in `mark` with a "now N" chip, and the y-scale kept.
  - Then a one-line footer: "Route plane online · everything routes through {endpoint}" and "cost is an estimate, not billing".
  - Same fetches, same period behaviour.
- **Routes band:**
  - A three-column grid: left Recent requests, middle the `/v1` hub (200px), right Providers (today's "Provider health" rows).
  - The connection metrics move into the Providers header: "N connections · N ready · N need attention", with "N inactive · N untested" under the list. The "needs attention" link target stays.
  - "from N active keys" goes in the Recent requests header, linked as today.
  - Wires: an SVG overlay in the middle column. Each request curves from its row to the hub. From the hub, a curve goes to every provider row: solid for providers named in the visible recent requests (matched by `provider` id, first matching connection row), dotted for idle ones. The newest request's two segments are 2px `mark-line`. Providers with hits show a muted "N of last M".
  - Positions are computed from row rects after fonts load and on resize, through a `ResizeObserver`.
  - The SVG is `aria-hidden`, because the rows already name the provider.
- **Below 860px:** the middle column is hidden and the lists stack. Each request row already names its provider.
- **States:**
  - Loading: skeleton rows at real height, no shimmer.
  - Empty traffic: today's "No traffic yet. Connect a provider" action.
  - Usage error: an inline message in the band.
  - No connections: an empty Providers list with today's message, and the hub shows no wires.

### Other pages (restyle only, same structure and controls)

| Page | Treatment |
|---|---|
| Endpoint & Key | Title row as on Overview. Base-URL strip as the endpoint group. Keys table with hairline rows, mono key ids, the inverted primary "Create key", and row menu unchanged. |
| Providers, `providers/new`, `providers/:id` | Section rules replace cards. Provider rows are hairline rows with ProviderIcon kept and status as dot+text. Connection rows, model rows and all modals adopt the base components. Breadcrumb above the title. |
| Combos | Each combo is a hairline row. Model chips are mono text with `/` aliases and quiet separators instead of filled pills. The fallback order reads left to right with a `→` separator. The strategy select uses the base Select. |
| System One | Base components; the question builder and answer view use `raised` panels. |
| Usage | KPI tiles become the big-number line. Charts follow the Overview chart style (recharts: dashed grid, `bar` fill, `mark` for current). Tables use hairline rows. ProviderTopology: see below. |
| Quota Tracker | Quota groups are `raised` cards. Bars are 6px tracks with a `bar` fill, `danger` under 10% left and `warning` under 30% (same thresholds as today's colour logic if it already has them; otherwise keep today's). Numbers are mono. |
| Token Saver, Console Log, Settings (profile), Settings/pricing, login, callback | Base components and section rules. The console log keeps mono on `raise`. |

### ProviderTopology (Usage): keep the animation, refactor it (owner request)

The owner likes the topology animation very much, so it stays. The electric edge, the travelling packets along the active edge, and the "powering" router node with its badge are all kept. It moves into the new language:

- **Recolour.** The active edge's cyan halo, green plasma and white core move to the signal family: a `mark` core, a `mark-line` halo at lower opacity, and packets in `mark`. Idle edges use `wire`, recently active edges `wire-live`. The "powering" router node uses `mark` and `mark-ink`, not `yellow-300/400`. Provider nodes become hairline boxes (1px `line-strong`, radius 6, `raise` fill) with ProviderIcon kept. The status ping dot keeps its animation and uses status colours.
- **Refactor.** Move the hardcoded colours and the `topology-*` keyframes into tokens and one CSS block. Every animation respects `prefers-reduced-motion`: edges stay lit and static, and packets are hidden. Graph logic, layout, data and xyflow usage stay the same. The `ProviderTopology` chunk stays lazy.
- **Shared with Overview.** Overview's newest-request wire reuses the same motion: one packet travels along the lit path, dashed and marching, through one shared SVG helper or the same CSS classes. It is static under reduced motion. The two signature pages then share one visual idea.

The "no glow" rule from the anti-goals does not apply inside the topology's active edge, because the owner asked to keep it. It still applies everywhere else.

## Answers to the builder check (my calls unless noted)

1. **Nav fit.** In the mock at 1440px, the full labelled nav plus the right cluster needs about 1,350px. The labelled top nav shows at **≥ 1360px**. Below that, the tablet Menu sheet (640–1359px) or the phone tab bar plus the More sheet (< 640px) take over. There are no icon-only or abbreviated nav states.
2. **Overview wires.**
   - Both lists keep today's `LIST_ROWS` (6) cap and "View all". There's no inner scrolling, and the overlay covers the band's height.
   - A request whose provider has no visible connection row draws its wire to the hub only and gets no outgoing segment.
   - "N of last M" counts only visible requests.
   - With no requests, the hub shows with dotted wires to providers. With no connections, the hub shows with no wires.
3. **Login and callback** (`shell: false`) keep their own layout and get the tokens, the type, the base components and the new mark. No top bar.
4. **Card.** The default `Card` switches to the rule style everywhere in the base-components commit. Each page task then audits its own call sites and sets `variant="raised"` where containment is needed: forms, code, quota groups, modal bodies, topology frame.
5. **Tests.** Changing unit or web tests that assert old class names or the sidebar DOM is acceptable when the behaviour they guard is kept. Say so in the commit and PR. If the `tests/parity` goldens change (for example SPA head tags from the font change), record each diff in `known-diffs.json` with a reason, and flag it prominently in the PR, because Plan 5 depends on parity.
6. **The mock** (`docs/superpowers/specs/assets/route-sheet-mock.html`) is authoritative for composition, proportions, colours and type. Pixel values are guidance.
7. **Quota thresholds:** keep whatever colour thresholds `ProviderLimits` uses today. Only the colours change.

## Constraints

- Bun only. No Node, npm or Next.
- No code comments: `local/no-comments` and the ratchet. Decisions go in an ADR, `docs/adr/0056-dashboard-route-sheet.md`.
- Gates on the branch: `bun run test` green with no regression, `bun --bun run eslint .`, `bun scripts/comments/ratchet.mjs --check`, `bun run build`, and the initial-JS budget test (`tests/web/build.test.js`, 650 KB).
- Report the bundle delta in the PR. Font files count separately.
- Stay in lane: `src/web`, `src/shared/components`, `src/web/globals.css`/`fonts.css`, root `package.json`/`bun.lock` (font package only), `docs/`. Snapshot/parity tests that encode SPA markup may need updating; flag every such change in the PR.
- Merge `origin/staging` before starting, and keep it merged. Plan 5 merged its gates (#255). Before opening the PR, check open PRs against `staging` and `main` for a cutover in flight.
- Implementation is done by Sonnet subagents in small reviewable commits. The order: tokens, then base components, then shell, then Overview, then the remaining pages.

## Left to the builder

- Exact Tailwind class choices, and whether `Card` sections are a new component or a `Card` variant (keep the public props stable).
- How the shared nav list module is named and placed.
- Recharts styling approach (props versus wrapper components).
- Skeleton component details within the stated rules.
