# Bun Rewrite — Plan 3: Dashboard SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Next.js dashboard with a React SPA bundled by `Bun.build`, served by the Bun server from Plan 2. All 16 pages keep their URLs and look, and no `next` import or dependency is left in the repo.

**Architecture:** The pages move from `src/app` to `src/web/pages`. A ~150-line in-house router (`src/web/router.js`) mirrors the `next/navigation` and `next/link` subset the code uses, so page bodies change only in their import lines. One `Bun.build` config (`src/web/build.js`, with `bun-plugin-tailwind`) produces `dist/web/` for both dev and production. The server reads the built `index.html`, injects `__LR_BOOT__` plus head tags through Plan 2's `serveSpa`, and serves `/assets/*` and `public/*` itself. Each page is a `React.lazy` chunk, and recharts, `@xyflow/react` and `@dnd-kit/*` stay out of the first load.

**Tech Stack:** Bun 1.4.4 (`Bun.build`, `HTMLRewriter`, `bun:test`), React 19.2.4, Tailwind 4.3.3 via `bun-plugin-tailwind`, `@fontsource-variable/*`, `happy-dom` (tests only), plain JavaScript ESM.

**Spec:** `docs/superpowers/specs/2026-11-22-bun-rewrite-design.md` (§6.5, §6.1, §6.6 asset inventory, §8 page walk-through gate, §9.4). Cross-plan names: `docs/superpowers/plans/2026-11-22-bun-rewrite-00-index.md`. Plan 2 (server) and Plan 4 (packaging) are separate documents; this plan lists the exact edits it makes to their files.

## Reconciliation (2026-11-23): this overrides the task text below

The index contract (`2026-11-22-bun-rewrite-00-index.md`) takes precedence over anything in this plan that disagrees with it.

- **Env var names:** `LITEROUTER_SPA_DIR` becomes **`LITEROUTER_SPA_DIR`**, and `LITEROUTER_PUBLIC_DIR` becomes **`LITEROUTER_PUBLIC_DIR`**.
  - Both names are resolved in `src/server/paths.js`, which Plan 2 creates. This plan adds `SPA_DIR` to that file.
  - `spaBuild.js` and `static.js` read `SPA_DIR` and `PUBLIC_DIR`; they never read the env vars directly.
- **Task 4:** `src/server/static.js` already exists from Plan 2 Task 6. **Modify it** to add `/assets/*` from `SPA_DIR`; don't create it from scratch. Keep Plan 2's existing tests green.
- **Build path:** Plan 4's `buildApp` calls this plan's `buildWeb({ production: true, outdir: <outdir>/web })`. Keep `buildWeb`'s signature stable.

## Global Constraints

- Bun pinned to **1.4.4** (`engines.bun`, CI `bun-version: 1.4.4`, as in Plan 1).
- **No visual redesign.** The same components and the same Tailwind classes. `src/web/globals.css` is `src/app/globals.css` moved, plus one `@import` line.
- **Plain JavaScript**, no TypeScript.
- **URLs stay identical:** `/`, `/login`, `/callback`, `/dashboard`, `/dashboard/providers`, `/dashboard/providers/new`, `/dashboard/providers/:id`, `/dashboard/combos`, `/dashboard/endpoint`, `/dashboard/quota`, `/dashboard/usage`, `/dashboard/console-log`, `/dashboard/systemone`, `/dashboard/token-saver`, `/dashboard/profile`, `/dashboard/settings/pricing`.
- **Boot data** is `window.__LR_BOOT__ = { timeZone: string, gaId: string | null, requireLogin: boolean, locale: string }`, injected at serve time after the guard. No new endpoint. `/login` and `/callback` get no more than they get today.
- **Fonts:** self-hosted IBM Plex Sans and JetBrains Mono, with the CSS variables `--font-plex` and `--font-jetbrains` kept.
- **Google Analytics** is a plain script, emitted only when the GA id is configured (today: `NEXT_PUBLIC_GA_ID` is truthy). The env var name does not change.
- **Metadata** (title, description, icon, manifest, theme colours) comes from `index.html`, `head.js` and a static manifest.
- **A server component becomes a client component with no new data fetching.** Nothing moves behind a new unauthenticated endpoint.
- **Unchanged names:** `~/.9router`, `DATA_DIR`, `NINEROUTER_*`, cookie names, `x-9r-*`, port 20128.
- Conventional Commits. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work lands on `staging` through PRs (rig auto-merge flow). Delegated or subagent work runs on **Sonnet 5.5** (`model: "sonnet"`).
- **No test may be deleted or weakened.** The tests that read dashboard sources by path (34 references in 22 files) are updated to the new paths only.

## Review Focus

1. **Deep links and encoded params.** Reloading `/dashboard/providers/<id>?x=1`, an id with `%2F`, a trailing slash, or a malformed `%` escape must render the right page or the not-found view, never throw. Pinned in Task 1 (`matchRoute`) and Task 4 (every route returns `index.html`).
2. **A lazy chunk that fails to load** (stale tab after an upgrade, flaky network) must show a "reload" message, not a blank page. Pinned in Task 3 (`RouteErrorBoundary`).
3. **Injection through boot or head values.** `gaId` with quotes or `</script>`, and a boot value with `</script>`, `<!--` or U+2028, must not break out of the tag. Pinned in Task 1 (`head.test.js`, `boot.test.js`) and Task 4.
4. **Stale `index.html`.** It points at hashed chunks that vanish on upgrade, so it must be `no-store`, and `/assets/*` immutable. Pinned in Task 4.
5. **Static paths that fall through to HTML or escape the root.** A missing `/assets/x.js` or `/providers/x.png` must be a 404, not `index.html`. `..`, `%2e%2e` and `%5c` must not read outside `public/` or the SPA dir. Pinned in Task 4.

---

## Probe findings this plan is built on (2026-11-23, Bun 1.4.4, Windows; probe dir `C:\Users\KOMPUTER\AppData\Local\Temp\claude\680b3c0368b65e0c\3e4ce144-be4b-4e34-ac1d-24ec5555884a\scratchpad\p3-probe`)

- **Tailwind v4 works.** `Bun.build({ entrypoints: ["x.html"], plugins: [bun-plugin-tailwind] })` compiles the repo's real `src/app/globals.css` (`@import "tailwindcss" source("../../")`, `@custom-variant`, `@theme inline`) in 0.6 s to 110 KB with no warnings. `bun-plugin-tailwind@0.1.2` has no dependencies beyond `tailwindcss`. `postcss` and `@tailwindcss/postcss` are not needed.
- **`bun build --compile` on the CLI cannot compile `source(...)`** (`Unexpected token: source(`). The production path must be the `Bun.build` API with the plugin. A `bunfig.toml` `[serve.static] plugins` entry works only for HTML-import routes in `bun run`.
- **HTML imports cannot be used.** `import html from "./index.html"` is an opaque `HTMLBundle` (`Object.keys` is empty) that Bun serves itself, so nothing can inject `__LR_BOOT__` after the guard. Decision: the server reads the built `index.html` from disk and rewrites it with `HTMLRewriter` (Plan 2's `serveSpa`).
- **Absolute URLs in the source HTML are resolved as files.** `<link rel="icon" href="/favicon.svg?v=2">` fails with "Could not resolve", or is rewritten to a hashed asset. `external` does not help for HTML references. Decision: icon, manifest and GA tags are not in the source `index.html`. `head.js` emits them server-side, and `index.html` keeps only URL-free tags (charset, viewport, colour-scheme, theme-color, title, description, inline scripts). Inline `<script>` bodies survive.
- **`publicPath: "/"` is required** (otherwise `./assets/x.js`, which breaks on nested routes). With `naming: { entry: "[dir]/[name].[ext]", chunk/asset: "assets/[name]-[hash].[ext]" }` the output is `index.html` plus `assets/*`.
- **`define: { "process.env.NODE_ENV": '"production"' }` is required in production builds.** Without it the bundle ships React's development build, with `jsxDEV` and the DevTools banner (entry 384 KB against 189 KB). Dev builds omit it.
- **Splitting works.** `React.lazy(() => import(...))` gives separate chunks (recharts 296 KB, `@xyflow/react` 168 KB). The metafile (`metafile: true`) lists the inputs per output, which the bundle test uses. CSS imported from a lazy chunk (`@xyflow/react/dist/style.css`) is hoisted into the main stylesheet, so it never goes missing.
- **Fonts.** `@fontsource-variable/ibm-plex-sans` and `@fontsource-variable/jetbrains-mono` work: `url("@fontsource-variable/<pkg>/files/<name>-latin-wght-normal.woff2")` is resolved by the bundler and inlined as base64. Next used `subsets: ["latin"]` only, so the plan uses the `latin` files only. `material-symbols/outlined.css` works through CSS `@import` and emits the 3.8 MB `material-symbols-outlined-*.woff2` as a hashed asset (the same file Next served today).
- **Full-app bundle probe** (all 16 pages, `DashboardLayout` and `RuntimeI18nProvider` with `next/*` shimmed) builds, with one exception. `open-sse/providers/registry/*.js` imports `../shared.js`, then `utils/claudeCliVersion.js`, then `utils/proxyFetch.js`, which does `await import("undici")`, and undici requires `node:sqlite`. A browser build fails unless `external: ["undici"]` is set. The remaining `process.env.*` reads in the bundle are `typeof process` guarded or inside function bodies. The shim is needed only if Plan 1 has not removed the dynamic `import("undici")`.
- **`/dashboard/settings/pricing` lives outside the `(dashboard)` group**, so today it renders with the root layout only: no sidebar, no header, no `TimezoneProvider`. The plan keeps it that way (`shell: false`).
- **The endpoint page is the only server component that fetches.** It calls `getMachineId()` and passes `machineId` to `EndpointPageClient`, which declares the prop (and a PropTypes `isRequired`) but never reads it (`grep machineId` hits lines 9 and 365 only). The prop is dropped, so no data moves.
- **`happy-dom`'s `GlobalRegistrator` works under `bun test`** (render, click, `history.pushState`, `popstate`). CSS imports (`@xyflow/react/dist/style.css`) also load under the Bun runtime, so page modules can be `import()`ed in tests.
- **`react-is` must stay.** It is a required peer of `recharts@3` (the bundler pulled it in), although no source file imports it. Removing it would break the chart chunk.
- **Next usage inventory** (grepped over all of `src/`): `next/navigation` in 11 files (`useRouter` push/replace, `usePathname`, `useSearchParams`, `useParams`, `redirect`); `next/link` in 7 files (props: `href`, `className`, `onClick`, `aria-current`, children); `next/dynamic` in 2 files (3 components, all `{ ssr: false }`); `next/image` in 1 file (`providers/[id]/page.js`); `next/font/google` and `@next/third-parties/google` in `src/app/layout.js`. `router.back`, `refresh` and `prefetch` are not used. `router.replace("?sortBy=...")` is a query-only relative href, and the `{ scroll: false }` option appears twice.

---

### Task 0: Pre-flight against merged Plan 2, and dependencies

**Files:**
- Modify: `package.json`, `tests/package.json`, `.gitignore`

- [ ] **Step 1:** Confirm the preconditions. Expected: `bun test` from `tests/` exits 0; `src/server/{index,routes,spa,guard,http,boot}.js` exist; `rg -n "next/|NextResponse" src/app/api src/lib src/sse src/dashboardGuard.js` finds nothing (otherwise Plan 2 has a gap, so fix it there, not here). Read `src/server/spa.js` and the non-API fallback in `src/server/index.js`. Write in the PR description where `serveSpa` reads the placeholder `src/web/index.html`, and where a request that missed the route table ends up. Tasks 3 and 4 edit exactly those two places.
- [ ] **Step 2:** Add dependencies: `bun add -d bun-plugin-tailwind @fontsource-variable/ibm-plex-sans @fontsource-variable/jetbrains-mono`, then `cd tests && bun add -d happy-dom @happy-dom/global-registrator`. They are dev dependencies because everything is bundled into `dist/web`. Add `/dist/` to `.gitignore`.
- [ ] **Step 3:** Commit: `chore(web): add bun-plugin-tailwind, variable fonts and happy-dom for the SPA`.

### Task 1: Router core, route table, boot reader and head tags (no pages yet)

**Files:**
- Create: `src/web/router.js`, `src/web/routes.js`, `src/web/boot.js`, `src/web/head.js`
- Test: `tests/web/router.test.js`, `tests/web/routes.test.js`, `tests/web/boot.test.js`, `tests/web/head.test.js`

**Interfaces:**
- Produces, in `src/web/router.js` (no dependency on `routes.js`; global state in `history`, no provider needed):
  - `matchRoute(pattern: string, pathname: string) → Record<string, string> | null`. Segments are `:name` or literal; a trailing slash is tolerated; params are `decodeURIComponent`-ed; a malformed escape returns `null` rather than throwing.
  - `resolveHref(href: string, base: string) → string | null`. Returns same-origin `pathname + search + hash`, or `null` for cross-origin or protocol-relative (`//host`). A query-only `?a=1` resolves against `base`.
  - `navigate(href: string, mode: "push" | "replace" = "push") → void`. It writes `history`, then notifies subscribers. A cross-origin href calls `location.assign(href)`.
  - `useRouter() → { push(href, opts?), replace(href, opts?), back(), refresh() }`. The object identity is stable. `opts` (`{ scroll }`) is accepted and ignored: scrolling happens in an inner `div`.
  - `usePathname() → string`
  - `useSearchParams() → URLSearchParams`. The identity is stable while the search string is unchanged.
  - `useParams() → Record<string, string>` (from `ParamsProvider`, default `{}`)
  - `ParamsProvider({ params, children })`
  - `Link({ href, onClick, target, ...rest })`: an `<a>` that intercepts only plain left-clicks on same-origin hrefs.
  - `redirect(href: string) → void` (= `navigate(href, "replace")`)
- Produces, in `src/web/routes.js` (pure data, no React import):
  - `routes: Array<{ path: string, load: () => Promise<{ default: Function }>, shell: boolean } | { path: string, redirect: string }>`
  - `findRoute(pathname: string) → { route, params } | null`. The first match wins, so `/dashboard/providers/new` precedes `/dashboard/providers/:id`.
- Produces, in `src/web/boot.js`: `getBoot() → { timeZone: string, gaId: string | null, requireLogin: boolean, locale: string }`. It reads `window.__LR_BOOT__` on each call and fills each missing or invalid field from the defaults `{ timeZone: server-resolved Intl zone or "UTC", gaId: null, requireLogin: true, locale: "en" }`. An invalid IANA zone is replaced by the default.
- Produces, in `src/web/head.js`: `headExtras({ gaId }: { gaId: string | null }) → string`. HTML for the head: `<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">`, `<link rel="shortcut icon" href="/favicon.svg?v=2">`, `<link rel="manifest" href="/manifest.webmanifest">`. If `gaId` matches `/^[A-Za-z0-9_-]{1,32}$/`, it also emits `<script async src="https://www.googletagmanager.com/gtag/js?id=<gaId>"></script>` and a `<script>` with the `dataLayer` / `gtag('js', new Date())` / `gtag('config', '<gaId>')` init. Any other `gaId` emits nothing for GA.

- [ ] **Step 1: Write the failing tests.** Tests that touch the DOM call `GlobalRegistrator.register({ url: "http://localhost/dashboard/usage?tab=logs" })` in `beforeAll` and `unregister()` in `afterAll`, and render with `react-dom/client` inside `act`.
  - `router.test.js`:
    - `"matchRoute binds params"`: `matchRoute("/dashboard/providers/:id", "/dashboard/providers/openai")` is `{ id: "openai" }`; `".../a%2Fb"` gives `{ id: "a/b" }`; `".../x/"` gives `{ id: "x" }`; `matchRoute("/dashboard", "/dashboard/")` is `{}`; `matchRoute("/dashboard", "/dashboard/x")` is `null`; `matchRoute("/dashboard/providers/:id", "/dashboard/providers/%E0%A4%A")` is `null` (no throw).
    - `"resolveHref"`: `("?tab=logs", "http://h/dashboard/usage?x=1#a")` is `"/dashboard/usage?tab=logs"`; `("/login", "http://h/dashboard")` is `"/login"`; `("https://evil.test/x", "http://h/")` and `("//evil.test/x", "http://h/")` are `null`.
    - `"hooks follow history"`: `usePathname()` is `/dashboard/usage`; `useSearchParams().get("tab")` is `logs`. After `router.push("/dashboard/providers")` the pathname is updated and `history.length` grew by 1. After `router.replace("?tab=details", { scroll: false })` the pathname is unchanged, `tab` is `details` and `history.length` is unchanged. A dispatched `popstate` after `history.pushState` re-renders.
    - `"useRouter and useSearchParams are referentially stable"` across re-renders with the same URL.
    - `"Link navigates on plain click"`: it calls `onClick` first, then pushes. Not navigating: when `onClick` calls `preventDefault`, with ctrl/meta/shift click, with `button: 1`, with `target="_blank"`, with a cross-origin `href`. It forwards `className` and `aria-current`.
    - `"redirect replaces"`: the pathname changes and `history.length` does not.
  - `routes.test.js`:
    - `"routes cover the 16 URLs"`: the sorted paths equal the list in Global Constraints.
    - `"findRoute order"`: `/dashboard/providers/new` resolves to the `new` route; `/dashboard/providers/openai` gives `params.id === "openai"`; `/dashboard/nope` and `/dashboard/providers/a/b` are `null`.
    - `"shell flags"`: `shell` is `false` for `/login`, `/callback` and `/dashboard/settings/pricing`, `true` for every other dashboard route; `/` has `redirect: "/dashboard"`.
  - `boot.test.js`:
    - no `window.__LR_BOOT__` gives the defaults;
    - a partial object is merged;
    - `timeZone: "Mars/Phobos"` falls back, as do wrong types (`requireLogin: "yes"`, `gaId: 5`);
    - values containing `</script><!--` pass through unchanged (the reader does not interpret them);
    - with no `window` at all it returns the defaults.
  - `head.test.js`:
    - `headExtras({ gaId: null })` contains the icon (`/favicon.svg?v=2`) and manifest links and not `googletagmanager`;
    - `headExtras({ gaId: "G-ABC123" })` contains `https://www.googletagmanager.com/gtag/js?id=G-ABC123` and `gtag('config', 'G-ABC123')`;
    - `gaId: 'x"></script><script>alert(1)</script>'` produces no `alert(1)` and no `googletagmanager`.
- [ ] **Step 2:** Run `cd tests && bun test web/`. Expected: FAIL (modules not found).
- [ ] **Step 3:** Implement the four modules per the Interfaces above.
  - `router.js`: a module-level listener set plus `useSyncExternalStore`. The snapshot is the string `pathname + search`, and `useSearchParams` is `useMemo` over the search part.
  - `Link` must also work for an `href` that is a template literal.
  - `routes.js` uses one `load: () => import("./pages/...")` per page. The file paths are the ones in Task 2's table. They do not exist until Task 2, so for this task `routes.js` is covered by `routes.test.js` only and is not imported by anything else.
- [ ] **Step 4:** Run `cd tests && bun test web/`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): in-house router, route table, boot reader and head tags`.

### Task 2: Move the 16 pages and remove `next/*` from the client tree

**Files:**
- Move: `src/app/(dashboard)/dashboard/**` to `src/web/pages/dashboard/**` (52 files), `src/app/dashboard/settings/pricing/page.js` to `src/web/pages/dashboard/settings/pricing/page.js`, `src/app/login/page.js` to `src/web/pages/login/page.js`, `src/app/callback/page.js` to `src/web/pages/callback/page.js`, `src/app/globals.css` to `src/web/globals.css`
- Modify: the 11 + 7 + 2 + 1 files below, `src/shared/components/UsageStats.js` imports of `@/app/(dashboard)/...`, and the 22 test files that reference old paths
- Test: `tests/web/no-next-in-client.test.js`

**Interfaces:**
- Consumes: `@/web/router` from Task 1 (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `Link`).
- Produces: every page file keeps its `export default`. Page file to route (the route is wired in Task 3):

| Old file under `src/app` | New file under `src/web/pages` | Route | Notes |
|---|---|---|---|
| `page.js` | (deleted) | `/` | server redirect; now a route entry and the guard's `/` redirect |
| `login/page.js` | `login/page.js` | `/login` | no Next imports |
| `callback/page.js` | `callback/page.js` | `/callback` | `useSearchParams` and `Suspense` kept |
| `(dashboard)/dashboard/page.js` | `dashboard/page.js` | `/dashboard` | |
| `.../combos/page.js` | `dashboard/combos/page.js` | `/dashboard/combos` | `next/dynamic` |
| `.../console-log/page.js` | `dashboard/console-log/page.js` | `/dashboard/console-log` | drop `export const dynamic` |
| `.../endpoint/page.js` | `dashboard/endpoint/page.js` | `/dashboard/endpoint` | server fetch of `machineId` removed |
| `.../profile/page.js` | `dashboard/profile/page.js` | `/dashboard/profile` | |
| `.../providers/page.js` | `dashboard/providers/page.js` | `/dashboard/providers` | `Link` |
| `.../providers/new/page.js` | `dashboard/providers/new/page.js` | `/dashboard/providers/new` | `useRouter`, `Link` |
| `.../providers/[id]/page.js` | `dashboard/providers/[id]/page.js` | `/dashboard/providers/:id` | `useParams`, `useRouter`, `Link`, `Image` |
| `.../quota/page.js` | `dashboard/quota/page.js` | `/dashboard/quota` | |
| `.../systemone/page.js` | `dashboard/systemone/page.js` | `/dashboard/systemone` | `Link` |
| `.../token-saver/page.js` | `dashboard/token-saver/page.js` | `/dashboard/token-saver` | |
| `.../usage/page.js` | `dashboard/usage/page.js` | `/dashboard/usage` | `useSearchParams`, `useRouter` |
| `dashboard/settings/pricing/page.js` | `dashboard/settings/pricing/page.js` | `/dashboard/settings/pricing` | no shell; unused `useRouter` removed |

- [ ] **Step 1: Write the failing test** `tests/web/no-next-in-client.test.js`. `"client tree has no next imports"` walks `src/web`, `src/shared`, `src/store`, `src/i18n` and `src/app/(dashboard)` / `src/app/login` / `src/app/callback` / `src/app/dashboard` (if they still exist), and for each `.js`/`.jsx` file asserts that `/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:next(?:\/[^"']*)?|@next\/[^"']*)["']/` does not match. Also `"no dashboard source is left under src/app outside api"`: `src/app` contains only `api` (this assertion is expected to fail until Step 4 and is the move's check).
- [ ] **Step 2:** Run `cd tests && bun test web/no-next-in-client.test.js`. Expected: FAIL, listing every offending file (the Next imports) and the leftover `src/app` entries.
- [ ] **Step 3: Move the files** (quote the paths: they contain parentheses and brackets):
  ```bash
  mkdir -p src/web/pages
  git mv "src/app/(dashboard)/dashboard" src/web/pages/dashboard
  git mv src/app/dashboard/settings src/web/pages/dashboard/settings
  git mv src/app/login src/web/pages/login
  git mv src/app/callback src/web/pages/callback
  git mv src/app/globals.css src/web/globals.css
  ```
  Then rewrite every reference to the old paths in `tests/`, `src/` and `scripts/`:
  ```bash
  rg -l "src/app/\(dashboard\)/dashboard|@/app/\(dashboard\)/dashboard|src/app/dashboard/settings|src/app/(login|callback)" tests src scripts \
    | xargs sed -i -E 's#src/app/\(dashboard\)/dashboard#src/web/pages/dashboard#g; s#@/app/\(dashboard\)/dashboard#@/web/pages/dashboard#g; s#src/app/dashboard/settings#src/web/pages/dashboard/settings#g; s#src/app/(login|callback)#src/web/pages/\1#g'
  ```
  Expected afterwards: `rg "src/app/\(dashboard\)|@/app/\(dashboard\)" tests src scripts` finds nothing. Tests such as `minimal-profile-boundary` that assert an old path does not exist keep their meaning because they now name the new directory.
- [ ] **Step 4: Replace the Next APIs** (page bodies otherwise unchanged):
  - **`next/navigation`** (11 files: `providers/new`, `providers/[id]`, `usage` pages, `callback`, `settings/pricing`, `RuntimeI18nProvider`, `Header`, `DashboardLayout`, `Sidebar`, `UsageStats`, plus `page.js`, which is deleted): change the import source to `@/web/router`. In `settings/pricing/page.js` delete the unused `useRouter`.
  - **`next/link`** (7 files): `import { Link } from "@/web/router";`.
  - **`next/dynamic`** (`combos/page.js`: `ComboFormModal`; `UsageStats.js`: `ProviderTopology`, `UsageChart`): `const X = lazy(() => import("..."));` with `lazy` from `react`. Wrap each render site (`<ComboFormModal>` ×2, `<ProviderTopology>`, `<UsageChart>`) in `<Suspense fallback={null}>`. `next/dynamic` rendered nothing while loading, so this keeps the behaviour. The `UsageStats.js` imports now point at `@/web/pages/dashboard/usage/components/...`.
  - **`next/image`** (`providers/[id]/page.js`): `<Image ... />` becomes `<img ... />` with the same props (`width`, `height`, `className`, `onError`, `loading`, `decoding`). `sizes` is harmless on `<img>`.
  - **`endpoint/page.js`**: export `EndpointPageClient` directly (`export { default } from "./EndpointPageClient"`), and remove the `machineId` parameter and its PropTypes `isRequired` line from `EndpointPageClient.js`.
  - **`console-log/page.js`**: remove `export const dynamic = "force-dynamic"` and its comment.
  - Leave every `"use client"` directive as it is (a no-op string).
- [ ] **Step 5:** Run `cd tests && bun test web/no-next-in-client.test.js`. Expected: the first test passes. The `src/app` assertion still fails because `src/app/layout.js`, `page.js`, `manifest.js` and `(dashboard)/layout.js` remain until Task 3. Then run `cd tests && CI=true bun test --parallel` plus the junit gates from Plan 1: `bun __baseline__/verify-no-regression.mjs ../test-results.xml` and `bun __baseline__/verify-test-counts.mjs ../test-results.xml`. Expected: no regression, and every file at or above its baseline count.
- [ ] **Step 6:** Commit: `refactor(web): move dashboard pages to src/web/pages and drop next/* imports`.

### Task 3: App shell, HTML entry, styles, fonts, manifest and the build

**Files:**
- Create: `src/web/index.html`, `src/web/main.jsx`, `src/web/App.jsx`, `src/web/fonts.css`, `src/web/build.js`, `scripts/build-web.mjs`, `public/manifest.webmanifest`
- Delete: `src/app/layout.js`, `src/app/page.js`, `src/app/manifest.js`, `src/app/(dashboard)/layout.js`
- Modify: `src/web/globals.css` (one line), `package.json` scripts, `public/` (delete 5 unused scaffold SVGs)
- Test: `tests/web/app.test.js`, `tests/web/build.test.js`

**Interfaces:**
- Consumes: `routes`, `findRoute` (Task 1); `getBoot`, `headExtras` (Task 1); `DashboardLayout`, `TimezoneProvider`, `ThemeProvider`, `RuntimeI18nProvider`.
- Produces:
  - `src/web/App.jsx`: `default function App()` (providers: `ThemeProvider` > `RuntimeI18nProvider` > `TimezoneProvider timeZone={getBoot().timeZone}` > `Routes`); `Routes()` (reads `usePathname`, picks the route, wraps in `DashboardLayout` when `route.shell`, in `ParamsProvider`, in `RouteErrorBoundary`, and in `<Suspense fallback={<CardSkeleton />}>`; a `redirect` route calls `redirect(to)` in an effect; no match renders `NotFound`); `NotFound()` (heading "Page not found" and a `Link` to `/dashboard`); `RouteErrorBoundary({ children })` (a class boundary that shows "This page failed to load" and a "Reload" button calling `location.reload()`). A lazy component per route is created once and cached by `route.path`. `App.jsx` imports no CSS, so tests can render it.
  - `src/web/build.js`:
    - `webBuildOptions({ production: boolean, outdir: string }) → Bun.BuildConfig`
    - `buildWeb({ production = true, outdir = "dist/web" } = {}) → Promise<{ outdir: string, indexHtml: string, metafile: object }>`. It throws an `Error` containing every build log message when `success` is false. It imports `bun-plugin-tailwind` dynamically, so a production server never loads it.
  - `scripts/build-web.mjs`: `bun scripts/build-web.mjs [--dev] [--outdir <dir>]`.
  - Output layout of `dist/web/`: `index.html` and `assets/*` with `publicPath` `/`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/web/app.test.js` (happy-dom registered with url `http://localhost/dashboard/nope`):
    - `"unknown route renders NotFound with a link to /dashboard"`;
    - `"/ redirects to /dashboard"`: after render, `location.pathname === "/dashboard"`;
    - `"a failing lazy page shows the reload message instead of a blank page"`: `Routes` rendered with a route whose `load` rejects (inject through an optional `routesOverride` prop on `Routes`), and the text "This page failed to load" appears;
    - `"every route page module loads and has a default export"`: for each non-redirect `routes` entry, `(await route.load()).default` is a function or object.
  - `tests/web/build.test.js` (`beforeAll`: `buildWeb({ production: true, outdir: <mkdtemp> })`, timeout 120 s):
    - `"index.html uses absolute asset URLs"`: matches `/src="\/assets\/index-[^"]+\.js"/` and has no `"./assets`;
    - `"no React development build"`: the entry JS has neither `jsxDEV` nor `Download the React DevTools`;
    - `"initial chunks exclude recharts, @xyflow and @dnd-kit"`: following `import-statement` edges from the output whose metafile `entryPoint` ends `web/index.html`, no reached output has an input key containing `node_modules/recharts`, `node_modules/@xyflow` or `node_modules/@dnd-kit`;
    - `"heavy libraries are in lazy chunks"`: some non-initial output has each of the three;
    - `"every page is its own lazy chunk"`: for each non-redirect route, some non-initial output has an input under `src/web/pages/`;
    - `"initial JS stays under 650 KB"`: the sum of initial JS sizes. Record the measured number in the PR. If it is over, find the offender with the metafile before touching the budget;
    - `"fonts and variables"`: the main CSS has `@font-face` for `IBM Plex Sans Variable` and `JetBrains Mono Variable`, and `--font-plex` and `--font-jetbrains` are defined;
    - `"material symbols font is emitted"`: some asset matches `material-symbols-outlined-*.woff2`;
    - `"bundle has no next/ module"`: no metafile input key contains `/node_modules/next/`.
- [ ] **Step 2:** Run `cd tests && bun test web/app.test.js web/build.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: HTML, CSS, fonts, manifest.**
  - `src/web/index.html`, ported from `src/app/layout.js`: `<html lang="en">`; charset; viewport; `<meta name="color-scheme" content="light dark">`; the two `theme-color` metas (`#f4f4f1` for light, `#121314` for dark, with `media`); `<title>LiteRouter — AI routing control plane</title>`; the description meta; the two inline scripts copied verbatim (persisted-theme class, `fonts-loaded`); `<link rel="stylesheet" href="./globals.css">`; `<body class="font-sans antialiased"><div id="root"></div><script type="module" src="./main.jsx"></script>`. **No `/...` URLs** (see the probe findings).
  - `src/web/main.jsx`: `createRoot(document.getElementById("root")).render(<App />)`.
  - `src/web/fonts.css`: `@import "material-symbols/outlined.css";`, then one `@font-face` per family (`font-weight: 100 700` for IBM Plex Sans Variable, `100 800` for JetBrains Mono Variable, `font-display: swap`, `format("woff2-variations")`) pointing at `@fontsource-variable/<pkg>/files/<name>-latin-wght-normal.woff2`, then `:root { --font-plex: "IBM Plex Sans Variable"; --font-jetbrains: "JetBrains Mono Variable"; }`. In `globals.css` add `@import "./fonts.css";` as the first line, before `@import "tailwindcss" source("../../")`. The source base stays the repo root, as today.
  - `public/manifest.webmanifest`: the object that `src/app/manifest.js` returns, as JSON, unchanged. Delete `src/app/manifest.js`.
  - Delete `public/next.svg`, `vercel.svg`, `file.svg`, `globe.svg` and `window.svg` after `rg "next\.svg|vercel\.svg|file\.svg|globe\.svg|window\.svg" src public` finds no reference.
- [ ] **Step 4: Build config.** `webBuildOptions` returns: `entrypoints: [src/web/index.html]`, `splitting: true`, `publicPath: "/"`, `naming: { entry: "[dir]/[name].[ext]", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" }`, `metafile: true`, `target: "browser"`, `plugins: [tailwind]`, and for production `minify: true` and `define: { "process.env.NODE_ENV": '"production"' }`; for dev `sourcemap: "linked"` and no `define`. Add `external: ["undici"]` only if `rg -n "undici" open-sse src` still finds a dynamic `import("undici")` (the probe needed it; Plan 1 may already have removed them). In that case add a code comment pointing at `open-sse/utils/proxyFetch.js`. Add the scripts `"build:web": "bun scripts/gen-provider-icon-manifest.mjs && bun scripts/build-web.mjs"`, and switch `predev` and `prebuild` from `node` to `bun`.
- [ ] **Step 5:** Implement `App.jsx`, `build.js` and `build-web.mjs` per the Interfaces. Port `src/app/(dashboard)/layout.js` as the `shell` branch (`DashboardLayout`) and delete the four old layout/page files.
- [ ] **Step 6:** Run `cd tests && bun test web/`. Expected: PASS. Then run `bun run build:web`. Expected: exit 0, `dist/web/index.html` present, and a table of chunk sizes with the largest being the `material-symbols` woff2.
- [ ] **Step 7:** Commit: `feat(web): SPA shell, Bun.build pipeline, self-hosted fonts and static manifest`.

### Task 4: Serve the SPA and static files from the Bun server

**Files:**
- Create: `src/server/spaBuild.js`, `src/server/static.js`
- Modify: `src/server/spa.js` (Plan 2), the non-API fallback in `src/server/index.js` (Plan 2)
- Test: `tests/server/spa-dashboard.test.js`

**Interfaces:**
- Consumes: `buildWeb` (Task 3), `headExtras` (Task 1), `serveSpa(req)` and the guard (Plan 2).
- Produces:
  - `src/server/spaBuild.js`: `getSpa() → Promise<{ dir: string, indexHtml: string }>`; `invalidateSpa() → void`. Resolution order: env `LITEROUTER_SPA_DIR`; else, when `NODE_ENV === "production"`, `<root>/dist/web` (it throws `Error("dist/web is missing: run bun run build:web")` if absent); else a dev build, `buildWeb({ production: false, outdir: <root>/dist/web-dev })`, memoised, with `fs.watch` (recursive) on `<root>/src` and `<root>/open-sse` calling `invalidateSpa()`. The watcher is not started when `LITEROUTER_SPA_DIR` or production is in effect. `<root>` is `path.resolve(import.meta.dir, "../..")`. Plan 4 changes only how `dir` is found when embedded.
  - `src/server/static.js`: `serveStatic(req: Request) → Promise<Response | null>`. GET and HEAD only. `/assets/*` comes from `getSpa().dir` with `Cache-Control: public, max-age=31536000, immutable`. Any other path is looked up under `public/` (`LITEROUTER_PUBLIC_DIR` overrides) with `Cache-Control: public, max-age=0`. Returns `null` when nothing matches (the caller then 404s). Path safety: decode once, reject `..`, `\`, NUL and dot-segments, `path.resolve`, then require that the result starts with the root plus `path.sep`.
  - `src/server/spa.js`: `serveSpa` takes `indexHtml` from `getSpa()` instead of the placeholder file. Its `HTMLRewriter` pass keeps the `__LR_BOOT__` script and now also `head` `append(headExtras({ gaId: boot.gaId }), { html: true })`. Responses carry `Cache-Control: no-store`. Boot JSON is serialised so that `<`, `>`, `&`, U+2028 and U+2029 are `\u`-escaped (check Plan 2's serialiser, and fix it there if it only uses `JSON.stringify`).
  - Fallback order in `index.js`: route table, then guard-approved SPA paths (`/login`, `/callback`, `/dashboard`, `/dashboard/*`) to `serveSpa`, then `serveStatic(req)`, then the existing 404. `/api/*` never reaches `serveStatic`.

- [ ] **Step 1: Write the failing tests** in `tests/server/spa-dashboard.test.js`. `beforeAll`: `buildWeb({ production: true, outdir: tmp })`, `process.env.LITEROUTER_SPA_DIR = tmp`, a temp `DATA_DIR` with `updateSettings({ requireLogin: false })`, `server = await startServer({ port: 0, hostname: "127.0.0.1" })`. `afterAll`: `server.stop(true)`.
  - `"every SPA route returns index.html with boot data"`: for every non-redirect path in `routes` (`:id` replaced by `openai`), plus `/dashboard/providers/a%2Fb` and `/dashboard/providers/openai/`: status 200, `content-type` starts with `text/html`, body contains `window.__LR_BOOT__`, `<link rel="manifest" href="/manifest.webmanifest">` and a `/assets/index-` script, and `cache-control` includes `no-store`.
  - `"/ redirects to /dashboard"`: `redirect: "manual"`, status 307, `location` ends with `/dashboard`.
  - `"unauthenticated dashboard request redirects to /login and carries no boot data"`: with `requireLogin: true` and no cookie, `/dashboard/providers` is a 307 to `/login`, and the body (if any) lacks `__LR_BOOT__`.
  - `"boot values are escaped"`: the injected script contains no raw `</script`, `<!--`, U+2028 or U+2029 inside the JSON.
  - `"no analytics tag when the id is unset"`: the body lacks `googletagmanager`.
  - `"every asset referenced by index.html resolves"`: every `/assets/...` URL in `index.html` is 200, JS is `text/javascript`, CSS is `text/css`, and `cache-control` contains `immutable`.
  - `"every provider icon in the manifest is served"`: for each id in `PROVIDER_ICON_IDS`, `/providers/<id>.png` is 200 with `image/png`.
  - `"public files keep their paths"`: `/favicon.svg` (`image/svg+xml`), `/icons/icon-192.svg`, `/icons/icon-512.svg`, `/sw.js`, `/i18n/literals/vi.json` (valid JSON) and `/manifest.webmanifest` (`application/manifest+json`, `name === "LiteRouter — AI routing control plane"`, three icons) are 200.
  - `"missing static paths are 404, never index.html"`: `/assets/nope.js`, `/providers/nope.png`, `/i18n/literals/zz.json` are 404 and not `text/html`.
  - `"traversal is refused"`: `/..%2f..%2fpackage.json`, `/%2e%2e/package.json`, `/icons/..%5c..%5cpackage.json` are 404 and the body does not contain `"dependencies"`.
  - `"unknown api path stays JSON 404"`: `/api/does-not-exist` gives a JSON body, not the SPA.
  - `"HEAD on an asset has no body"`.
- [ ] **Step 2:** Run `cd tests && bun test server/spa-dashboard.test.js`. Expected: FAIL (the placeholder page is still served).
- [ ] **Step 3:** Implement `spaBuild.js` and `static.js`, and make the `spa.js` and `index.js` edits described above.
- [ ] **Step 4:** Run `cd tests && bun test server/spa-dashboard.test.js`. Expected: PASS.
- [ ] **Step 5:** Dev loop check. Run `bun --hot src/server/index.js`, open `http://127.0.0.1:20128/dashboard`, change a string in `src/shared/components/Sidebar.js`, and reload. Expected: the first request builds (~1 s), and the reload shows the change without restarting the server. This is a full reload, not HMR.
- [ ] **Step 6:** Commit: `feat(server): serve the SPA build and public assets with boot and head injection`.

### Task 5: Browser walk-through of every page

**Files:** none (evidence goes in the PR description).

The repo has no browser test dependency, and the Playwright plugin is available in the harness. Use its tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_evaluate`, `browser_console_messages` with level `error`, `browser_network_requests`). If it is not available, do the same by hand in a browser with DevTools open.

- [ ] **Step 1: Start a production-like server.**
  ```bash
  bun run build:web
  DATA_DIR="$(mktemp -d)" INITIAL_PASSWORD=walkthrough-pass-1 TZ=Asia/Jakarta NODE_ENV=production PORT=20128 bun src/server/index.js
  ```
  Optional parity run: check out `main` in a worktree, run it on port 20129 with the same env, and compare screenshots of overview, providers and usage at 1280 px and 390 px.
- [ ] **Step 2:** For each row, open the URL fresh (hard reload) and then reach it by in-app navigation. Pass means: the page renders, it does the listed check, `browser_console_messages` has no errors, and `browser_network_requests` has no 4xx/5xx for `/assets`, `/providers`, `/icons` and `/i18n`.

| Page | URL | Check |
|---|---|---|
| Login | `/login` | wrong password shows an error; right password goes to `/dashboard`; `/api/auth/status` with `requireLogin=false` goes straight to `/dashboard` |
| Overview | `/dashboard` | cards load; "Connect provider" opens `/dashboard/providers/new`; a connection row opens its provider page |
| Providers list | `/dashboard/providers` | provider icons load (and a missing one falls back to its text icon); cards link to `/dashboard/providers/<id>`; header search works |
| Provider new | `/dashboard/providers/new` | creating a compatible node returns to `/dashboard/providers` |
| Provider detail | `/dashboard/providers/<id>` | breadcrumb and header icon (`<img>`); add API key; the OAuth modal opens; delete returns to the list; reload keeps the page |
| OAuth callback | `/callback?code=abc&state=xyz` | from a dashboard tab, `window.open("/callback?code=abc&state=xyz")` posts to the opener and sets `localStorage.oauth_callback`; the page shows "Authorization Successful!" and closes itself. `/callback` with no params shows "Copy This URL". A page on another origin cannot receive the message (the origin allow-list is unchanged) |
| Combos | `/dashboard/combos` | the form modal opens (lazy chunk loads once) and drag-and-drop reorders |
| Endpoint & Key | `/dashboard/endpoint` | the page renders with no `machineId`; keys table; quickstart snippets |
| Quota | `/dashboard/quota` | skeleton, then limits |
| Usage | `/dashboard/usage` | Overview/Details tabs change `?tab=` without a full reload; back and forward work; sorting uses `?sortBy=`; chart and topology chunks load; the "Today" period; dates show GMT+7 |
| Console log | `/dashboard/console-log` | SSE stream shows lines |
| System One | `/dashboard/systemone` | "Configure providers" link works |
| Token saver | `/dashboard/token-saver` | status loads |
| Profile | `/dashboard/profile` | theme toggle persists across reload with no flash; switching language loads `/i18n/literals/<locale>.json` and translates; password change; logout goes to `/login` |
| Pricing | `/dashboard/settings/pricing` | renders **without** sidebar and header (as today); the pricing modal saves |

- [ ] **Step 3:** Also check: `/dashboard/nope` shows "Page not found" with a link back; offline-simulate one lazy chunk (block `/assets/Chart-*` in the network panel) and open Usage: the reload message appears; with `NEXT_PUBLIC_GA_ID=G-TEST123` set, the `gtag/js?id=G-TEST123` request is made, and without it no request goes to `googletagmanager.com`.
- [ ] **Step 4:** Record the result table in the PR description. Fix findings with failing tests first where they are testable.

### Task 6: Remove Next from the repo

**Files:**
- Delete: `next.config.mjs`, `postcss.config.mjs`, `src/app/` everything except `api/`, and (only if Plan 2 left them) `src/proxy.js`, `src/instrumentation.js`, `custom-server.js` with the tests that exist only for them
- Modify: `package.json`, `bun.lock`, `.github/workflows/test.yml`, `CLAUDE.md`
- Test: `tests/web/no-next-imports.test.js`

- [ ] **Step 1: Write the failing test** `tests/web/no-next-imports.test.js`:
  - `"no source file imports next"`: walks `src`, `open-sse`, `scripts` and `cli/src`, and asserts the regex from Task 2 matches nothing. (`cli/package.json` and `cli/scripts/build-cli.js` belong to Plan 4.)
  - `"root package.json has no next packages"`: no key in `dependencies`, `devDependencies` or `optionalDependencies` equals `next`, `@next/third-parties`, `@next/swc-linux-x64-musl`, `postcss` or `@tailwindcss/postcss`.
  - `"src/app contains only api"`.
- [ ] **Step 2:** Run `cd tests && bun test web/no-next-imports.test.js`. Expected: FAIL, listing what remains.
- [ ] **Step 3:** Delete the files above. In `package.json`, remove `next`, `@next/third-parties`, `@next/swc-linux-x64-musl`, `postcss` and `@tailwindcss/postcss`. Remove the scripts that call `next`: `dev:webpack`, `build:webpack`, `dev:bun`, `build:bun`, `start:bun`, `postbuild`, `postbuild:bun`. Point `build` at `bun run build:web` for now (Plan 4 replaces it with the compile pipeline). Run `bun install` to refresh `bun.lock`. Before removing anything else, run `for d in <each dependency>; do rg -l "from ['\"]$d" src open-sse scripts cli/src; done`; a dependency with no importer may go, except those listed in the next step.
- [ ] **Step 4: Keep on purpose, and say why in the PR.**
  - `react-is`: required peer of `recharts@3` (see the probe findings).
  - `eslint-config-next`, plus `eslint.config.mjs` as it stands: the config imports `eslint-config-next/core-web-vitals`. Removing the package breaks `bunx eslint .`, and Plan 4 owns the lint migration. `eslint-config-next` does not depend on the `next` package, so `bunx eslint .` must still pass after Step 3 (verify it).
  - `lightningcss-linux-x64-musl`, `@tailwindcss/oxide-linux-x64-musl`: needed on Alpine only if the SPA is built inside the image. Plan 4 decides (it can build `dist/web` outside Docker).
  - `package-lock.json`: not touched. Plan 4 deletes it with the Dockerfile's `npm ci`.
- [ ] **Step 5: CI and docs.**
  - `.github/workflows/test.yml`: replace the build step Plan 1 left (`bun run build:bun` and the `.next/standalone` size check) with `bun run build:web`. The size budget is the `build.test.js` assertion, so no separate check is needed.
  - `CLAUDE.md`: in Commands add `bun run build:web` (writes `dist/web`); in the file layout text, replace `src/app` with `src/web` for the dashboard and keep `src/app/api` for the handlers; delete the sentence that says `next dev` loads no `custom-server.js` only if Plan 2 has not already done so.
- [ ] **Step 6:** Run `cd tests && CI=true bun test --parallel`, then the junit gates (`verify-no-regression.mjs`, `verify-test-counts.mjs`), then `bunx eslint .`, then `bun run build:web`. Expected: all green, and `rg -n "\"next\"|from ['\"]next" package.json src open-sse scripts` finds nothing.
- [ ] **Step 7:** Commit: `chore: remove next and the Next config; the dashboard builds with bun only`.

---

## Left for Plan 4 (still mentions Next after this plan)

`cli/package.json` (`next` dependency) and `cli/scripts/build-cli.js`; `Dockerfile`, `.dockerignore`, `.npmignore`, `.gitignore` `.next` entries; `docker-publish.yml` and `production-image.yml`; `scripts/copy-standalone-assets.mjs`; `package-lock.json`; `ARCHITECTURE.md` and README text. Also for Plan 4: embed `dist/web` and `public/` in the compiled executable and point `getSpa()` and `serveStatic` at the embedded copies; call `buildWeb({ production: true })` from `scripts/build.mjs` instead of a second `Bun.build` config; consider moving the now build-time-only runtime dependencies (`react`, `react-dom`, `recharts`, `@xyflow/react`, `@dnd-kit/*`, `zustand`, `material-symbols`, `prop-types`) to `devDependencies`.

## Done when

- `cd tests && CI=true bun test --parallel` exits 0 and both junit gates pass. The test count is at least Plan 1's, plus the new `tests/web/*` and `tests/server/spa-dashboard.test.js`.
- `bun run build:web` exits 0, and the initial JS is under the 650 KB test budget with recharts, `@xyflow/react` and `@dnd-kit/*` in lazy chunks only.
- `rg -n "from ['\"]next|@next/|next/" src open-sse scripts` finds nothing; `src/app` contains only `api/`; `next.config.mjs` and `postcss.config.mjs` are gone.
- The Task 5 table is complete in the PR with no console errors, and the 16 URLs behave as listed in Global Constraints.
