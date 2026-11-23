# ADR-0054: Dashboard SPA: Bun.build, in-house router, dev build per process and lint without Next

- Status: Accepted
- Date: 2026-11-23
- Origin: Plan 3 (dashboard SPA) tasks 1 to 6

## Context

The dashboard used to be Next App Router pages built by `next build` and served by Next. Plan 3 replaces it with a React SPA built by `Bun.build` and served by the same `Bun.serve` process as the gateway, so the repo carries no `next`, `postcss` or `eslint-config-next`. Several choices are not visible from the code and are easy to undo by accident.

## Decisions

### D1. `Bun.build` with an in-house router, not wouter

`src/web/build.js` (`buildWeb`) bundles `src/web/main.jsx` with `bun-plugin-tailwind`, splits recharts, `@xyflow/react` and `@dnd-kit/*` into lazy chunks, and keeps the initial JS under the 650 KB budget asserted in `tests/web/build.test.js`. Routing is `src/web/router.js` and `src/web/routes.js` rather than wouter: the dashboard used `useRouter`, `usePathname`, `useSearchParams`, `useParams`, `Link` and `redirect` from `next/navigation` and `next/link` in a dozen-plus files, so a router with the same names and shapes keeps every page body unchanged apart from its import line, and it needs no new dependency. The route table is a flat list of patterns; `findRoute(pathname, list)` matches it.

**Where:** `src/web/build.js`; `src/web/router.js`; `src/web/routes.js`; `src/web/App.jsx`; `scripts/build-web.mjs`; `tests/web/router.test.js`; `tests/web/routes.test.js`; `tests/web/build.test.js`

### D2. No HTML imports: boot data is injected after the guard

Serving the SPA through `Bun.serve`'s HTML import would hand the server an opaque `HTMLBundle`, with no point at which per-request boot data (`window.__LR_BOOT__`: the session, settings and locale the guard has just resolved) and head tags can be injected. The build therefore writes `index.html` plus assets to disk, and `serveSpa` reads the built `index.html`, injects the serialized boot script and `headExtras({ gaId })` with `HTMLRewriter`, and answers after the guard has run. `/assets/*` comes from the same directory with immutable caching.

**Where:** `src/server/spa.js`; `src/server/spaBuild.js`; `src/web/boot.js`; `src/web/head.js`; `tests/server/spa-dashboard.test.js`

### D3. One dev build directory per process

When `LITEROUTER_SPA_DIR` is unset and `NODE_ENV` is not `production`, `getSpa()` builds into `dist/web-dev/<pid>` and rebuilds when `src/` or `open-sse/` change. The directory is per process because two dev servers (or `bun --hot` beside a test server) sharing one outdir would delete each other's chunk files mid-request. The directory is removed on exit, and a process that starts first prunes directories whose pid is dead. Builds are serialized through one promise chain.

**Where:** `src/server/spaBuild.js`; `.gitignore` (`/dist/`)

### D4. A missing production build answers 500

With `NODE_ENV=production`, or with `LITEROUTER_SPA_DIR` set, `getSpa()` only reads the directory and never builds. If `index.html` is missing, `spaUnavailableResponse` answers 500 with a plain text "dashboard is not built" message and logs the cause. An empty or half-built directory must fail loudly rather than serve a blank page. API routes are unaffected. `src/server/paths.js` exports `SPA_DIR_OVERRIDE` (the resolved `LITEROUTER_SPA_DIR`, or `null`) so the server knows whether the directory was chosen by the operator.

**Where:** `src/server/spaBuild.js`: `getSpa`, `spaUnavailableResponse`; `src/server/paths.js`

### D5. `router.refresh()` is a re-notify and `{ scroll }` is ignored

Next's `router.refresh()` re-fetched server components; with no server components it has nothing to refetch, so `refresh()` only notifies subscribers of the location again, which re-runs location-driven effects. Pages fetch their own data and still do that themselves. `router.push` and `router.replace` take an `href` only: the two call sites that passed `{ scroll: false }` keep passing it and it is ignored, because the SPA never resets scroll on a query-only change.

**Where:** `src/web/router.js`; `tests/web/router.test.js`

### D6. ESLint no longer uses `eslint-config-next`

`eslint-config-next@16.4.6` does not declare `next` as a dependency, but its parser (`dist/parser.js`) requires `next/dist/compiled/babel/eslint-parser`, so ESLint cannot load the config once `next` is uninstalled. The migration that Plan 4 had planned landed in Plan 3 Task 6 instead (the controller's ruling R21). `eslint.config.mjs` is now a flat config that uses the plugins `eslint-config-next/core-web-vitals` configured, as direct devDependencies at the versions it pulled in: `eslint-plugin-react` 7.37.5, `eslint-plugin-react-hooks` 7.1.1, `eslint-plugin-jsx-a11y` 6.10.2, `eslint-plugin-import` 2.32.0 and `globals` 16.4.0 (`browser` plus `node`). Files parse with ESLint's default parser (espree, `ecmaFeatures.jsx`, `sourceType: "module"`), not Babel; `cli/cli.js` is `commonjs` because it returns at top level. The rule set is the same: the `react` recommended rules, the `react-hooks` recommended rules with the six React Compiler rules still `warn`, `import/no-anonymous-default-export`, the six `jsx-a11y` rules, and `local/no-comments`. Only the 22 `@next/next/*` rules went, together with the `.next/**` and `next-env.d.ts` ignores and the TypeScript and import-resolver settings no rule used. `@next/next/*` disable directives were removed with them. `@eslint/js` recommended stays out, as it was under `eslint-config-next`. Warnings went from 191 to 183: the eight `@next/next` warnings (five `no-location-assign-relative-destination`, three `no-img-element`) are the whole difference.

**Where:** `eslint.config.mjs`; `package.json` devDependencies; `tests/web/no-next-imports.test.js`

## Consequences

- Changing the router's public names means touching every page and component that imports it; keep them in step with `next/navigation`'s shape or update `tests/web/router.test.js` with them.
- Adding an HTML entry to `Bun.build` would bypass the boot injection and the guard.
- Two dev servers on one checkout are safe; a crashed dev server leaves a `dist/web-dev/<pid>` that the next start prunes.
- Plan 4 verifies the ESLint config and adds nothing to it unless it decides to turn on `@eslint/js` recommended, which would raise new findings on today's code.
