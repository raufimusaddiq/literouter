# ADR-0034: Dashboard UI behavior and hydration

- Status: Accepted
- Date: 2026-11-23
- Origin: recovered from code comments in the 2026-11-23 comment audit

## Context

The dashboard is a Next.js app rendered on the server and hydrated on the client, with heavy visualization libraries (@xyflow/react, recharts, @dnd-kit) and provider cards that must agree with the provider detail pages. Several small decisions keep server and client output identical, keep bundles small, and keep counts and status consistent across screens. They are easy to undo by accident because each looks like a harmless cleanup.

## Decisions

### D1. Server and client must render identical text: one timezone, empty origin, early theme

The server's effective zone (`TZ`) is handed to the client by the dashboard layout through `TimezoneProvider`, which sets the app timezone synchronously during render (before children) so the SSR pass and hydration format dates in the same zone and every viewer sees the deployment's zone. `useOrigin` renders an empty origin on the server and during the hydration pass so markup matches, then re-renders with the real origin right after. The persisted theme is applied before first paint by an inline script in the root layout, mirroring the zustand-persist `theme` key and the `dark` class `applyTheme()` sets, so a reload does not flash the default light theme before the client store hydrates.

**Where:** `src/shared/utils/dateTime.js`; `src/shared/components/TimezoneProvider.js`; `src/shared/hooks/useOrigin.js`; `src/web/App.jsx`; `src/web/index.html` (the early-theme script)

### D2. Provider card counts use the same auth rules as the detail page

Dual-auth providers (oauth plus apikey) store API keys as authType `apikey` and sometimes `api_key`, so card stats count both so totals match the detail page. Kiro has no `authModes` in the registry but accepts both (headless uses `api_key`). Free-tier and API-key providers default to supporting apikey even when the registry entry omits `authModes` (for example cloudflare-ai, byteplus, ollama, vertex), otherwise their keys are invisible on the grid card. Free Tier cards may be oauth-only (kimchi) or dual-auth, so counting uses `dualAuthTypes` per provider instead of a fixed "apikey". The enable/disable toggle follows the same rule. Providers with no auth (`noAuth`, such as free proxies) are always usable even though they never have a stored connection, so they never fall into the "none" status.

**Where:** `src/web/pages/dashboard/providers/page.js`; `src/web/pages/dashboard/providers/utils.js`

### D3. Heavy libraries are lazy-loaded and the layout renders one Sidebar

`@dnd-kit` is lazy-loaded so it stays out of the combos page chunk until the form modal opens, and `@xyflow/react` plus recharts are lazy-loaded so they stay out of the shared bundle until rendered. `DashboardLayout` renders a single `<Sidebar>` that is the static column on desktop and the off-canvas drawer on mobile; rendering it twice doubled RSC prefetches and duplicated nav, aside and h1 in the accessibility tree. The provider topology uses a particle beam instead of the built-in animated edge, because the built-in animation uses `stroke-dasharray`, which is CPU-heavy.

**Where:** `src/web/pages/dashboard/combos/page.js`; `src/shared/components/UsageStats.js`; `src/shared/components/layouts/DashboardLayout.js`; `src/web/pages/dashboard/usage/components/ProviderTopology.js`

### D4. Drag and drop avoids CSS transitions on drop

The sortable item in the combo form has no transition so the CSS settle animation does not fight React's re-render on drop.

**Where:** `src/web/pages/dashboard/combos/ComboFormModal.js`

### D5. A provider test records its result against the tested model

At `LOG_LEVEL=WARN` a passing probe emits no server log line, so the row recorded against that model is the only trace a successful test leaves.

**Where:** `src/web/pages/dashboard/providers/[id]/page.js`: model test handler

## Consequences

- Formatting dates with the browser's zone or reading the origin during render causes hydration mismatches and flashing text.
- Removing the early theme script brings back a light-theme flash on reload.
- Counting a fixed auth type on cards makes keys or OAuth connections vanish from the grid while the detail page still shows them.
- Eager imports of dnd-kit, xyflow or recharts bloat shared chunks; a second Sidebar doubles prefetches and breaks accessibility.
- Dropping the per-model test record leaves successful tests untraceable at low log levels.
