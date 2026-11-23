import { matchRoute } from "./router.js";

export const routes = [
  { path: "/", redirect: "/dashboard" },
  { path: "/login", load: () => import("./pages/login/page.js"), shell: false },
  { path: "/callback", load: () => import("./pages/callback/page.js"), shell: false },
  { path: "/dashboard", load: () => import("./pages/dashboard/page.js"), shell: true },
  { path: "/dashboard/combos", load: () => import("./pages/dashboard/combos/page.js"), shell: true },
  { path: "/dashboard/console-log", load: () => import("./pages/dashboard/console-log/page.js"), shell: true },
  { path: "/dashboard/endpoint", load: () => import("./pages/dashboard/endpoint/page.js"), shell: true },
  { path: "/dashboard/profile", load: () => import("./pages/dashboard/profile/page.js"), shell: true },
  { path: "/dashboard/providers", load: () => import("./pages/dashboard/providers/page.js"), shell: true },
  { path: "/dashboard/providers/new", load: () => import("./pages/dashboard/providers/new/page.js"), shell: true },
  { path: "/dashboard/providers/:id", load: () => import("./pages/dashboard/providers/[id]/page.js"), shell: true },
  { path: "/dashboard/quota", load: () => import("./pages/dashboard/quota/page.js"), shell: true },
  { path: "/dashboard/systemone", load: () => import("./pages/dashboard/systemone/page.js"), shell: true },
  { path: "/dashboard/token-saver", load: () => import("./pages/dashboard/token-saver/page.js"), shell: true },
  { path: "/dashboard/usage", load: () => import("./pages/dashboard/usage/page.js"), shell: true },
  { path: "/dashboard/settings/pricing", load: () => import("./pages/dashboard/settings/pricing/page.js"), shell: false },
];

export function findRoute(pathname) {
  for (const route of routes) {
    const params = matchRoute(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}
