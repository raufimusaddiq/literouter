# Dashboard Route Sheet Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the LiteRouter dashboard SPA into the owner-approved "Route Sheet" design without changing any route, flow, data, API call or action.

**Architecture:**
- The work is a token-first restyle on the existing React 19 + Tailwind v4 SPA. Existing `--color-*` tokens are remapped and new ones added in `src/web/globals.css`, so every page shifts in one step.
- Base components then take the new language.
- A new shell (top bar, tablet sheet, phone tab bar and More sheet) replaces the sidebar.
- Overview gets the signature routes band, and `ProviderTopology` keeps its animation in the new colours.
- Pages are restyled one group per task.
- A guard test grows task by task so retired styles can't return.

**Tech Stack:** React 19, Tailwind v4 via `bun-plugin-tailwind`, `Bun.build`, `bun test` with happy-dom (`tests/`), recharts, `@xyflow/react`, `material-symbols`, `@fontsource-variable/*`.

**Spec:** `docs/superpowers/specs/2026-11-23-dashboard-route-sheet-design.md`. The mock is `docs/superpowers/specs/assets/route-sheet-mock.html`, authoritative for composition, proportions, colours and type. Read both before any task.

## Global Constraints

- **Bun only:** no Node, no npm, no Next. Install with `bun add`. Tests use `cd tests && bun test <file>` for one file and `bun run test` for the suite.
- **No code comments.** `local/no-comments` and `bun scripts/comments/ratchet.mjs --check` enforce this. Decisions go in `docs/adr/0057-dashboard-route-sheet.md`.
- **Stay in lane:**
  - Allowed: `src/web/**`, `src/shared/components/**`, `src/shared/hooks/**`, `src/store/themeStore.js` (read-only unless needed), `docs/**`, and `tests/web/**` or `tests/unit/**` for tests this plan names.
  - Root `package.json` and `bun.lock` only for `@fontsource-variable/schibsted-grotesk`.
  - Never touch `src/server/**`, `open-sse/**`, `src/app/api/**`, `scripts/**`, CI or `cli/**`.
- **Behaviour stays:**
  - Every route, fetch, store call, handler, aria attribute, `id` used by links (e.g. `#needs-attention`), and control.
  - When a test asserts an old class string, update the assertion to the new class while keeping the semantic it guards (heading level, label, attribute). Name the change in the commit body.
- **Tailwind stays.** Tokens are wired through `@theme inline`; the theme switches via the `.dark` class from `themeStore`.
- **Fonts:**
  - Text: `@fontsource-variable/schibsted-grotesk`, pinned to exactly `5.3.0`.
  - Mono: `@fontsource-variable/jetbrains-mono` stays.
  - Both are served as hashed `.woff2` files under `/assets/`, not inlined as `data:`.
- **Colour meaning:**
  - `mark` (#ffd23f) is now/current/selected only.
  - `ok` is healthy only.
  - `danger` is failing only.
  - Everything else is neutral.
  - No gradients, glows (except inside `ProviderTopology`'s active edge), purple/indigo, cream ground or terracotta.
- **Glass:** `backdrop-filter` is allowed only on the desktop/tablet top bar.
- **Shadows:** allowed only on Modal, Drawer, menus/popovers and sheets.
- **Breakpoints:**
  - Labelled top nav at `≥ 1360px`.
  - Tablet Menu sheet at `640–1359px`.
  - Phone bottom tab bar plus More sheet at `< 640px`.
- **z-index order:** toasts 80 > Modal/Drawer 60 > More/Menu sheet 50 > phone tab bar 40 > top bar 30.
- **Budgets:**
  - Initial JS stays under 650 KB (`tests/web/build.test.js`).
  - Report initial JS and main CSS sizes (raw and gzip) before and after in the PR.
- **Commits:** Conventional Commits, small, one task per commit or more. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Gates at the end of every task:**
  - `cd tests && bun test web unit/a11y-headings.test.js unit/a11y-tooltip.test.js unit/dashboard-a11y-t27.test.js unit/minimal-profile-boundary.test.js`
  - `bun --bun run eslint .`
  - `bun scripts/comments/ratchet.mjs --check`
  - `bun run build:web`

## Review Focus

1. **Long names:** a 120-character model, provider or account name truncates on one line and never pushes the wires, the figures or the row height (Task 5 test).
2. **Translated nav labels:** labels longer than English must not overflow the top nav at 1360px. The nav folds to the Menu button whenever its links overflow, not only below 1360px (Task 4 test).
3. **Phone keyboard:** focusing a text field on a phone hides the bottom tab bar, so it never covers the field. It comes back on blur (Task 4 test).
4. **Modal over phone chrome:** a Modal opened on a phone covers the tab bar and the More sheet, and Escape closes only the topmost layer (Task 4 test).
5. **Many providers:** 40+ connections or more requests than `LIST_ROWS` produce wires only for the visible rows; hidden ones never draw (Task 5 test).

---

### Task 1: Baseline, tokens, fonts and ADR

**Files:**
- Modify: `src/web/globals.css`, `src/web/fonts.css`, `src/web/index.html` (the two `theme-color` metas become `#f3f4f4` and `#111212`), `package.json`, `bun.lock`.
- Create: `docs/adr/0057-dashboard-route-sheet.md` (and add it to `docs/adr/README.md`), `tests/web/route-sheet-guards.test.js`.
- Modify test: `tests/web/build.test.js` (the "fonts and variables" case).

**Interfaces:**
- Produces Tailwind colour utilities that every later task uses:
  - existing names, remapped: `bg`, `bg-alt`, `surface`, `surface-2`, `surface-3`, `sidebar`, `border`, `border-subtle`, `text-main`, `text-muted`, `text-subtle`, `primary`, `primary-hover`, `primary-foreground`, `success`, `danger`, `warning`, `info`, `brand-*`;
  - new: `raise`, `line`, `line-strong`, `ink`, `muted`, `faint`, `bar`, `mark`, `mark-ink`, `mark-line`, `ok`, `wire`, `wire-live`, `grid`.
- Produces font variables `--font-sans` (Schibsted Grotesk Variable stack) and `--font-mono` (JetBrains Mono Variable stack).
- Produces CSS custom properties with the same names for SVG code: `var(--color-mark)`, `var(--color-wire)`, and so on.
- Produces the guard test file, with an exported-in-file array `GUARDED_PATHS` that later tasks append to.

- [ ] **Step 1:** Record the baseline:
  - `bun run build`.
  - The initial JS bytes from `cd tests && bun test web/build.test.js` (it logs `initial JS bytes`).
  - The main CSS file's raw and gzip size in `dist/app/web/assets/index-*.css`.
  - The pass/fail counts of `bun run test`.

  Write all of it into the ADR's "Baseline" section.
- [ ] **Step 2:** Write the failing tests.
  - In `tests/web/build.test.js`, replace the "fonts and variables" assertions:

    ```js
    expect(css).toContain("Schibsted Grotesk Variable");
    expect(css).toContain("JetBrains Mono Variable");
    expect(css).not.toContain("data:font/woff2");
    expect(css).not.toContain("IBM Plex Sans");
    const assets = fs.readdirSync(path.join(outdir, "assets"));
    expect(assets.some((n) => /schibsted.*\.woff2$/i.test(n))).toBe(true);
    expect(assets.some((n) => /jetbrains.*\.woff2$/i.test(n))).toBe(true);
    ```

  - In `tests/web/route-sheet-guards.test.js`:
    - `it("globals.css carries the Route Sheet tokens")` reads `src/web/globals.css` and expects each of `--color-mark: #ffd23f`, `--color-wire`, `--color-wire-live`, `--color-grid`, `--color-mark-line`, `--color-raise`.
    - `it("decorative leftovers are gone")` expects none of `bg-hero-gradient`, `bg-vibrancy`, `traffic-light`, `btn-cta`, `border-glow`, `pulseGlow`, `ctaShimmer`, or `rgba(79, 70, 229` in `globals.css`.
    - Declare `const GUARDED_PATHS = []` and `const FORBIDDEN = [/backdrop-blur/, /shadow-\[var\(--shadow-(elev|warm|elevated)\)\]/, /\bfill-1\b/, /animate-(border-glow|pulse-glow)/, /rounded-(2xl|\[14px\]|\[20px\])/]`.
    - `it("guarded files use no retired styles")` walks every `.js` file under each guarded path and fails, naming the file and pattern, on any match. It passes trivially while the list is empty.
- [ ] **Step 3:** Run `cd tests && bun test web/build.test.js web/route-sheet-guards.test.js`. Expected: FAIL on the fonts and tokens assertions.
- [ ] **Step 4:** Implement:
  - Add the font: `bun add -d @fontsource-variable/schibsted-grotesk@5.3.0`.
  - In `fonts.css`, load both fonts so `Bun.build` emits files. Either `@import` each package's CSS, the way `material-symbols/outlined.css` already works, or use relative `url()` paths that the bundler copies. Confirm in `dist/web/assets` that no `data:` font remains.
  - Remap the `:root` and `.dark` token values to the spec's tables (§Tokens). Add the new tokens to both blocks and to `@theme inline`.
  - Remove the decorative leftovers. A class still referenced in source keeps its name with a flat style: `grep -rn` each one before deleting it.
  - Set `.material-symbols-outlined` defaults to `font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20` and `font-size: 18px`.
  - Make the selection and scrollbar colours neutral.
  - Write the ADR with these sections: context (the rejected rounds), decision (Route Sheet), tokens, glass and shadow rules, the topology exception, the `@ui-sdk` verdict with the measured numbers (+58.5 KB gzip for Menu, +73.5 KB for Dialog+Menu+Tooltip+Tabs, against a React baseline of 56.5 KB), Tailwind kept, and the baseline.
- [ ] **Step 5:** Run the Task 1 tests, then all the gates. Expected: PASS. Open the built dashboard (`PORT=20128 bun --hot src/server/index.js` with a throwaway `DATA_DIR`) and confirm every page still renders, now in the new palette.
- [ ] **Step 6:** Commit: `feat(web): Route Sheet tokens, Schibsted Grotesk, fonts served as files`.

### Task 2: Base components

**Files:**
- Modify in `src/shared/components/`: `Button.js`, `Card.js`, `Input.js`, `Select.js`, `Toggle.js`, `Badge.js`, `SegmentedControl.js`, `Modal.js`, `Drawer.js`, `Tooltip.js`, `Pagination.js`, `Loading.js`.
- Tests: `tests/unit/a11y-headings.test.js` (Badge assertion), `tests/web/route-sheet-guards.test.js`, and create `tests/web/base-components.test.js`.

**Interfaces:**
- **Card:** `Card({ variant = "section" | "raised", title, subtitle, icon, action, padding, hover, elev, className, ...props })`.
  - `elev` is accepted and ignored.
  - `section` renders a 1px `border-t border-line-strong` block with no fill and no radius.
  - `raised` renders `rounded-lg border border-line-strong bg-raise`.
  - `Card.Section`, `Card.Row` and `Card.ListItem` keep their names.
  - The title stays an `<h2>`.
- **Button:** keeps every variant name (`primary`, `secondary`, `outline`, `ghost`, `danger`, `success`) and size name (`sm`, `md`, `lg`). Heights are sm 28px, md 32px, lg 36px, with radius 6.
- **Modal:** keeps its props. `showTrafficLights` is accepted and renders nothing. It uses z-index 60 and the `raise` surface with one shadow.
- **Badge:** keeps `variant` and `size`. The default is a dot plus text, and `sm` stays at least 11px.

- [ ] **Step 1:** Write the failing tests in `tests/web/base-components.test.js` (happy-dom render, as `tests/web/app.test.js` does):
  - `it("Card raised renders a bordered raise surface")`: `render(<Card variant="raised" title="T">x</Card>)` has a root class containing `bg-raise` and `border`, and has `h2` text `T`.
  - `it("Card section default has no shadow class")`: the root class string matches no `/shadow/`.
  - `it("Modal renders no traffic lights and keeps dialog semantics")`: `<Modal isOpen title="X" onClose={()=>{}} showTrafficLights>`. Assert:
    - the `[role=dialog][aria-modal=true]` element exists;
    - there is no `.traffic-light` element;
    - Escape calls `onClose`.
  - `it("Button primary is the inverted ink style")`: the class contains `bg-ink` and `text-bg`.
  - Append `"src/shared/components"` to `GUARDED_PATHS`.
- [ ] **Step 2:** Run `cd tests && bun test web/base-components.test.js web/route-sheet-guards.test.js`. Expected: FAIL.
- [ ] **Step 3:** Restyle each component per spec §Base components:
  - Inputs are 36px with radius 6, a 1px `line-strong` border, a `raise` fill and a focus ring of 2px `mark-line`.
  - Toggle "on" is `ink`.
  - SegmentedControl has a 1px track, and the active segment is filled `ink` with `bg` text.
  - Tooltip has no arrow.
  - Pagination uses text buttons.
  - Skeletons are flat `bg-surface-2` bars with no shimmer.
  - Update the Badge regex in `a11y-headings.test.js` to the new `sm` class string, keeping the 11px minimum.
- [ ] **Step 4:** Run the Task 2 tests, then the gates. Expected: PASS. Eyeball one modal-heavy page (Providers) in both themes.
- [ ] **Step 5:** Commit: `feat(web): Route Sheet base components`.

### Task 3: Shared nav list and accessible menus

**Files:**
- Create: `src/shared/components/nav/navItems.js`, `src/shared/hooks/useMenuKeys.js`.
- Modify: `src/shared/components/HeaderMenu.js`, `src/web/pages/dashboard/endpoint/components/KeyRowMenu.js`, `tests/unit/minimal-profile-boundary.test.js` (read `navItems.js` instead of `Sidebar.js`, with the same assertions).
- Test: `tests/web/nav-items.test.js`, `tests/web/header-menu.test.js`.

**Interfaces:**
- **`navItems.js`** exports:
  - `NAV_GROUPS`: `[{ id: "operate"|"route"|"observe"|"system", label }]`.
  - `NAV_ITEMS`: `[{ href, label, shortLabel, icon, group, primary }]`, in today's order and with today's labels from `Sidebar.js`.
  - `isNavActive(href: string, pathname: string): boolean`, which keeps Sidebar's rule: `/dashboard` is an exact match, and everything else is a prefix match.
  - The `primary: true` entries are exactly `/dashboard`, `/dashboard/providers`, `/dashboard/usage` and `/dashboard/endpoint`, with `shortLabel` values "Overview", "Providers", "Usage" and "Keys".
- **`useMenuKeys({ open, setOpen, triggerRef, menuRef })`** returns nothing. It handles:
  - ArrowDown/ArrowUp, wrapping;
  - Home and End;
  - Escape, which closes and focuses the trigger;
  - Tab, which closes;
  - a mousedown outside, which closes;
  - opening, which focuses the first `[role=menuitem]`.

- [ ] **Step 1:** Write the failing tests.
  - `nav-items.test.js`:
    - 10 items; hrefs equal the shell routes in `src/web/routes.js` minus `/`, `/login`, `/callback`, `/dashboard/providers/new`, `/dashboard/providers/:id` and `/dashboard/settings/pricing`;
    - 4 groups, in the order operate, route, observe, system;
    - exactly 4 `primary`;
    - `isNavActive("/dashboard","/dashboard/usage") === false`;
    - `isNavActive("/dashboard/providers","/dashboard/providers/abc") === true`.
  - `header-menu.test.js` (happy-dom):
    - opening the menu focuses the first item;
    - ArrowDown moves focus to the next item;
    - Escape closes the menu and returns focus to the trigger;
    - the items have `role="menuitem"` inside `role="menu"`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - Add `navItems.js` and `useMenuKeys.js`.
  - `HeaderMenu` gets `role="menu"` and menu items, and uses the hook.
  - `KeyRowMenu` switches to the hook, keeping its exact current behaviour.
  - Point `minimal-profile-boundary.test.js` at `navItems.js`. Keep `"/dashboard/console-log"` present and `nonMinimal` absent.
- [ ] **Step 4:** Run the two new tests, `unit/minimal-profile-boundary.test.js`, then the gates. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): shared nav list and keyboard-accessible header menu`.

### Task 4: Shell: top bar, tablet sheet, phone tab bar and More sheet

**Files:**
- Create in `src/shared/components/shell/`: `TopBar.js`, `NavSheet.js`, `PhoneTabBar.js`, `LogoMark.js`, `PageHeader.js`.
- Modify: `src/shared/components/layouts/DashboardLayout.js`, `src/shared/components/Header.js` (keep `getPageInfo`, exported; drop its bar UI), `tests/unit/dashboard-a11y-t27.test.js` (Header assertion moves to `PageHeader.js`).
- Delete: `src/shared/components/Sidebar.js`. Grep for imports first.
- Test: `tests/web/shell.test.js`. `tests/web/app.test.js` must stay green unchanged.

**Interfaces:**
- **`TopBar({ onOpenMenu })`** at 52px. It reads `NAV_ITEMS`. The nav links render when the viewport is ≥ 1360px and the nav `scrollWidth <= clientWidth` (measured with a `ResizeObserver`); otherwise a "Menu" button with `aria-expanded` calls `onOpenMenu`. The active link has `aria-current="page"` and a 2px `mark` underline. Below 640px the TopBar is 48px and shows `LogoMark`, the current page title from `getPageInfo`, ThemeToggle and HeaderMenu.
- **`NavSheet({ open, onClose, variant: "full" | "bottom" })`**: `role="dialog"`, `aria-modal`, `aria-labelledby` pointing to its "All pages" title. It has the 4 groups, 10 rows of 48px or more, the current row marked, the language switch and Logout last. It closes on Escape, the backdrop, the close button, a downward swipe on the handle (`bottom` only) or navigation. It traps focus and returns focus to the opener, and locks body scroll. `bottom` is at most 85vh and slides up; it shows instantly under `prefers-reduced-motion`.
- **`PhoneTabBar({ onOpenMore })`**: fixed bottom, 56px plus `env(safe-area-inset-bottom)`, five targets (four `primary` items plus More). Active marking follows `isNavActive`; More is active when no primary item matches. It sets `hidden` while an `input`, `textarea`, `select` or `[contenteditable]` inside `main` has focus.
- **`PageHeader({ actions })`** renders breadcrumbs (when `getPageInfo` gives them), then the `<h1>` title row with `actions` on the right. Pages pass their existing header actions. A page that renders its own `<h1>` today keeps it and doesn't use `PageHeader`'s title.
- **`DashboardLayout`:**
  - The scroll container stays `main` with a child `div.overflow-y-auto` (required by `tests/web/app.test.js`).
  - `TopBar` sits inside that scroller as `position: sticky; top: 0`, so content scrolls beneath its blur.
  - Below 640px the content gets `padding-bottom: calc(56px + env(safe-area-inset-bottom) + 16px)`.
  - Toasts follow the spec: a `raise` box with a 3px status left edge, at z-index 80, and on phones above the tab bar.

- [ ] **Step 1:** Write the failing tests in `tests/web/shell.test.js` (happy-dom; stub `window.matchMedia` and `ResizeObserver` per case):
  - `it("desktop: 10 labelled links, current marked")`: at 1440px on `/dashboard/usage`, 10 `nav a` and `aria-current="page"` on Usage.
  - `it("overflowing nav folds to Menu")`: at 1440px with the nav's `scrollWidth` stubbed above `clientWidth`, a `button[aria-expanded]` named "Menu" is present and no nav links render.
  - `it("phone: tab bar has 5 targets and More is active on combos")`: at 390px on `/dashboard/combos`, 5 tab targets, and More has `aria-current="page"` (or its active marker).
  - `it("More sheet is a modal dialog that closes on Escape and restores focus")`.
  - `it("tab bar hides while a text field is focused")`: focus an `<input>` in main, then the tab bar is `hidden`; blur, then it's visible.
  - `it("Escape closes only the topmost layer")`: open the More sheet, then a `Modal` above it. Escape closes the Modal and leaves the sheet open.
- [ ] **Step 2:** Run `cd tests && bun test web/shell.test.js web/app.test.js`. Expected: shell FAIL, app PASS.
- [ ] **Step 3:** Implement the components and the layout per the interfaces and spec §Shell, using `LogoMark` from the mock's SVG. Move the Header assertion in `dashboard-a11y-t27.test.js` to `PageHeader.js`: no `<h1` in the breadcrumb element, and the title is an `<h1>`. Append `"src/shared/components/shell"` and `"src/shared/components/layouts"` to `GUARDED_PATHS`.
- [ ] **Step 4:** Run the Task 4 tests, `web/app.test.js`, then the gates. Expected: PASS. Run the dev server and check by hand:
  - 1440px: top nav.
  - 1280px: Menu sheet.
  - 390px: tab bar and More sheet, with a swipe-close on a touch-emulated viewport.
  - Keyboard-only navigation through every nav item.
  - Both themes.
- [ ] **Step 5:** Commit: `feat(web): Route Sheet shell with top bar, tablet sheet and phone tab bar`.

### Task 5: Overview: traffic band and routes band

**Files:**
- Create in `src/web/pages/dashboard/overview/`: `routeLinks.js`, `RoutesBand.js`, `RouteWires.js`.
- Modify: `src/web/pages/dashboard/DashboardOverview.js`, and `src/web/globals.css` (shared wire motion classes).
- Test: `tests/web/route-links.test.js`, `tests/web/overview.test.js`.

**Interfaces:**
- **`computeRouteLinks(recent: Array<{ provider }>, rows: Array<{ provider }>): { links: Array<{ from: number, to: number | null }>, hits: Map<string, number>, newest: number | null }`**
  - `to` is the index of the first row whose `provider` equals the request's, or `null`.
  - `hits` counts visible requests per provider id.
  - `newest` is 0 when `recent` is non-empty.
- **`RouteWires({ containerRef, requestRefs, providerRefs, links, hot: Set<string>, newest })`** renders an `aria-hidden` SVG. It re-measures after `document.fonts.ready` and on `ResizeObserver`, and renders nothing when its column is `display: none`. The newest request's two segments use `.lr-wire-live`, and one `.lr-packet` travels along them.
- **globals.css** gets `.lr-wire-live` (2px `var(--color-mark-line)` with a dashed march animation) and `.lr-packet` (an 5px `var(--color-mark)` circle moved with `<animateMotion>`). Both are static under `prefers-reduced-motion`, where the packet is hidden. Task 6 reuses them.

- [ ] **Step 1:** Write the failing tests.
  - `route-links.test.js`:
    - `computeRouteLinks([{provider:"cc"},{provider:"kn"},{provider:"zz"}], [{provider:"kn"},{provider:"cc"},{provider:"cc"}])` deep-equals `{ links:[{from:0,to:1},{from:1,to:0},{from:2,to:null}], hits: Map {"cc"→1,"kn"→1,"zz"→1}, newest:0 }`.
    - Empty inputs give `{ links:[], hits: Map{}, newest:null }`.
  - `overview.test.js` (happy-dom, `fetch` stubbed with DATA.md-shaped payloads: 6 connections, 5 recent requests):
    - the big-number line shows "4,783", "469.5M", "3.2M" and "~$51.38";
    - there are no four stat-card tiles (no element with `data-metric`);
    - the Providers header text contains "6 connections · 6 ready · 0 need attention";
    - the `#needs-attention` link target still exists;
    - a recent request with a 120-character model name renders in an element with class `truncate`;
    - with 40 connections and 10 recent requests, at most `LIST_ROWS` (6) provider rows and 6 request rows render.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement per spec §Overview and the mock:
  - **Title row:** "Overview", the endpoint group (URL in mono, then Protected/Open, then Copy), then "Updated hh:mm" and Refresh.
  - **Traffic band:** the big-number line plus the period switch (`SegmentedControl`), the chart (dashed grid, `bar` fill, the current bucket in `mark` with a "now N" chip, the y-scale kept), then the one-line footer.
  - **Routes band:** a three-column grid at ≥ 860px (`1fr 200px 1fr`), with the hub and `RouteWires`. It stacks below 860px.
  - Keep every fetch, the `period` state, the loading, empty and error branches, and every link.
  - Append `"src/web/pages/dashboard/overview"` and `"src/web/pages/dashboard/DashboardOverview.js"` to `GUARDED_PATHS`.
- [ ] **Step 4:** Run the Task 5 tests, then the gates. Expected: PASS. Run the dev server with real usage (point `DATA_DIR` at a copy of a populated data dir if you have one, or make a few `/v1` requests). Check at 1440, 1024 and 390, light and dark, and with reduced motion on.
- [ ] **Step 5:** Commit: `feat(web): Overview traffic and routes bands`.

### Task 6: ProviderTopology: keep the animation, recolour and refactor

**Files:**
- Modify: `src/web/pages/dashboard/usage/components/ProviderTopology.js`, and its CSS. Today that CSS is in the lazy `ProviderTopology-*.css` chunk, so find its source with `grep -rn "topology-edge" src`.
- Test: `tests/web/route-sheet-guards.test.js` (new cases).

**Interfaces:**
- **Consumes:** `.lr-packet` and `.lr-wire-live` from Task 5, and the tokens from Task 1.
- **Produces:** no new exports. Its props, graph logic, layout and xyflow usage stay unchanged.

- [ ] **Step 1:** Add the failing guard cases:
  - `it("topology uses tokens, not hardcoded colours")`: `ProviderTopology.js` contains none of `#22d3ee`, `#4ade80`, `#f8fafc`, `yellow-300` or `yellow-400`, and does contain `var(--color-mark`.
  - `it("topology animations respect reduced motion")`: the topology CSS source contains `@media (prefers-reduced-motion: reduce)` covering the `topology-edge` classes and `.lr-packet`.
- [ ] **Step 2:** Run the guard test. Expected: FAIL.
- [ ] **Step 3:** Recolour per spec §ProviderTopology.
  - **Keep:** the electric turbulence, the halo, the core, the travelling packets and the router "powering" badge.
  - **Map:** the core to `mark`, the halo to `mark-line` at lower opacity, idle edges to `wire`, recent edges to `wire-live`, and the router node to `mark` and `mark-ink`.
  - **Provider nodes:** 1px `line-strong` border, radius 6, `raise` fill, with `ProviderIcon` kept.
  - **Status ping:** colour from status tokens.
  - Move all keyframes into one CSS block with the reduced-motion fallback (edges lit and static, packets hidden). Append the topology file to `GUARDED_PATHS`.
- [ ] **Step 4:** Run the guard test, `web/build.test.js` (xyflow stays in a lazy chunk), then the gates. Expected: PASS. Check by eye on Usage, while traffic flows, in both themes: the animation must still look alive.
- [ ] **Step 5:** Commit: `feat(web): ProviderTopology in Route Sheet colours, animation kept`.

### Task 7: Usage page

**Files:**
- Modify: `src/web/pages/dashboard/usage/page.js` and `usage/components/` (`OverviewCards.js`, `UsageChart.js`, `UsageTable.js`, `RequestDetailsTab.js`, `tokenDisplay.js` if it holds styles), and `src/shared/components/UsageStats.js`, `RequestLogger.js`.
- Test: `tests/web/route-sheet-guards.test.js` (append paths). `unit/dashboard-a11y-t27.test.js` keeps passing.

**Interfaces:**
- **Consumes:** `PageHeader`, `SegmentedControl`, `Card variant`, and the tokens.

- [ ] **Step 1:** Append to `GUARDED_PATHS`: `"src/web/pages/dashboard/usage/page.js"`, then each file directly under `usage/components/` (not the `ProviderLimits/` directory, which Task 9 owns; `ProviderTopology.js` is already guarded), then `"src/shared/components/UsageStats.js"` and `"src/shared/components/RequestLogger.js"`. Run it. Expected: FAIL, listing the offending classes.
- [ ] **Step 2:** Restyle:
  - `OverviewCards` becomes the big-number line, like Overview, with the same values and labels.
  - recharts gets `CartesianGrid strokeDasharray="3 4"` in `var(--color-grid)`, bars or lines in `var(--color-bar)`, and the current period in `var(--color-mark)`. The axes are mono 11px.
  - Tables get hairline rows, mono IDs and right-aligned figures.
  - Tabs (Overview/Details, Tokens/Cost) use `SegmentedControl` or underline tabs, without changing their state logic.
  - `UsageTable` keeps rendering no heading when `title` is empty.
- [ ] **Step 3:** Run the guard test and the gates. Expected: PASS. Check by eye at 1440 and 390 in both themes.
- [ ] **Step 4:** Commit: `feat(web): restyle Usage`.

### Task 8: Providers (list, new, detail) and the provider modals

**Files:**
- Modify: `src/web/pages/dashboard/providers/**`; in `src/shared/components/`: `ProviderIcon.js`, `CapacityBadges.js`, `EditConnectionModal.js`, `OAuthModal.js`, `KiroAuthModal.js`, `KiroOAuthWrapper.js`, `KiroSocialOAuthModal.js`, `CursorAuthModal.js`, `GitLabAuthModal.js`, `IFlowCookieModal.js`, `XiaomiMimoAuthModal.js`, `ModelSelectModal.js`, `NoAuthProxyCard.js`, `PricingModal.js`.
- Tests: `unit/a11y-headings.test.js` (provider detail `<h1>{providerInfo.name}</h1>` stays), `unit/a11y-tooltip.test.js` (stays green), the guard test.

- [ ] **Step 1:** Append `"src/web/pages/dashboard/providers"` and each listed shared modal file to `GUARDED_PATHS`. Run it. Expected: FAIL.
- [ ] **Step 2:** Restyle per spec §Other pages:
  - Section rules replace cards.
  - Provider rows become hairline rows with `ProviderIcon` and a dot-plus-text status.
  - Connection and model rows get row actions that stay visible on focus.
  - Each section's "Add …" and "Test All" actions use base `Button`.
  - The breadcrumb comes from `PageHeader`, and `providerInfo.name` stays the `<h1>`.
  - Modal bodies use `Card variant="raised"` only where they need containment.
  - `CooldownTimer` figures are in mono.
- [ ] **Step 3:** Run the a11y tests, the guard test and the gates. Expected: PASS. Open every modal at least once (Add API key, OAuth start, Edit connection, Model select, Bulk import) in both themes and at 390px.
- [ ] **Step 4:** Commit: `feat(web): restyle Providers and provider modals`.

### Task 9: Endpoint & Key, Combos, Quota

**Files:**
- Modify: `src/web/pages/dashboard/endpoint/**`, `src/web/pages/dashboard/combos/**`, `src/web/pages/dashboard/quota/**`, `src/web/pages/dashboard/usage/components/ProviderLimits/**`.
- Tests: `unit/dashboard-a11y-t27.test.js`. Its quota assertion keeps "account cards use h2, not h3": update the exact class string to the new one, and keep `not.toMatch(/<h3 /)`. Also `unit/endpoint-quickstart-snippets.test.js` and the guard test.

- [ ] **Step 1:** Append the four paths to `GUARDED_PATHS`. Run it. Expected: FAIL.
- [ ] **Step 2:** Restyle:
  - **Endpoint:**
    - The base-URL strip is the endpoint group.
    - The "Require API key" Toggle is restyled.
    - The keys table has hairline rows with mono key IDs, "Create key" is the primary `Button`, and the `KeyRowMenu` behaviour is unchanged.
    - Quickstart uses a `raised` code block.
  - **Combos:**
    - Each combo is a hairline row.
    - Model chips are mono text with quiet `→` separators in fallback order, and the vision/capability glyphs are kept.
    - The strategy select uses the base `Select`.
    - The Copy, Edit and Delete actions use `Button` ghost/danger.
    - `ComboFormModal` uses the base components and keeps its drag and drop (`@dnd-kit`) untouched.
  - **Quota:**
    - Account groups are `Card variant="raised"`.
    - Bars are 6px tracks with a `bar` fill. Keep today's threshold logic; only the colour tokens change, to `danger` and `warning`.
    - Figures and reset timers are in mono.
    - The filter row uses base `Select` and `Button`.
- [ ] **Step 3:** Run the tests and gates. Expected: PASS. Check by eye: create, edit and delete a combo, drag to reorder, toggle a key, and a quota toggle, at 1440 and 390 in both themes.
- [ ] **Step 4:** Commit: `feat(web): restyle Endpoint, Combos and Quota`.

### Task 10: System One, Token Saver, Console Log, Settings, pricing, login, callback

**Files:**
- Modify: `src/web/pages/dashboard/systemone/**`, `token-saver/**`, `console-log/**`, `profile/**`, `settings/pricing/page.js`, `src/web/pages/login/page.js`, `src/web/pages/callback/page.js`, the `NotFound` and `RouteErrorBoundary` markup in `src/web/App.jsx` (text and structure unchanged, because `tests/web/app.test.js` asserts it), and `LanguageSwitcher.js`, `HeaderLanguage.js`, `ThemeToggle.js`, `Drawer.js` call sites.
- Tests: `unit/dashboard-a11y-t27.test.js` (the token-saver headroom assertion stays), `tests/web/app.test.js`, the guard test.

- [ ] **Step 1:** Append these paths to `GUARDED_PATHS`. Run it. Expected: FAIL.
- [ ] **Step 2:** Restyle per spec §Other pages:
  - System One's builder and answer views use `raised` panels.
  - Console Log is mono on `raise`.
  - Settings sections become hairline rows: label column, then controls.
  - Login and callback keep their own layout without a shell, with `LogoMark`, tokens and base components.
- [ ] **Step 3:** Run the tests and gates. Expected: PASS. Check by eye: log in and out, the theme toggle, the language switch, a System One request, and Token Saver toggles.
- [ ] **Step 4:** Commit: `feat(web): restyle remaining pages`.

### Task 11: Full verification and the PR

**Files:**
- Modify: `docs/adr/0057-dashboard-route-sheet.md` ("Result" section), `CHANGELOG.md`.

- [ ] **Step 1:** Confirm `GUARDED_PATHS` now covers `src/web/pages`, `src/shared/components` and `src/web/App.jsx`. Run `grep -rn "Sidebar" src` and expect no imports.
- [ ] **Step 2:** Run every gate:
  - `bun run test`: the pass count is at least the Task 1 baseline, with no new failures.
  - `bun --bun run eslint .`
  - `bun scripts/comments/ratchet.mjs --check`
  - `bun scripts/gen-route-table.mjs --check`
  - `bun scripts/port-next-routes.mjs --check src`
  - `bun run build`
  - `bun tests/parity/run.mjs --target bun --out parity-actual`, then `bun tests/parity/compare.mjs` as CI does. Any golden diff gets a `known-diffs.json` entry with a reason, flagged in the PR.
- [ ] **Step 3:** Capture screenshots with a throwaway `DATA_DIR` and a few real requests: all 16 routes, light and dark, at 1440×900, 768×1024 and 390×844, including the More sheet open and one modal open. Store them outside the repo and attach them to the PR.
- [ ] **Step 4:** Write the ADR "Result" section: initial JS and main CSS raw/gzip before and after, the font files' sizes, and any parity diffs. Add a `CHANGELOG.md` entry.
- [ ] **Step 5:** Check open PRs against `staging` and `main` for a Plan 5 cutover in flight, merge `origin/staging` again, and re-run the gates. Open the PR against `staging`, or against `main` if the cutover has landed, saying so. Follow the rig flow: `gh pr merge --auto --merge`, gated on CI and Hermes Review. Don't merge while a cutover PR is open.
