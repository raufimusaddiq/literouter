import { describe, it, expect } from "bun:test";
import { routes } from "../../src/web/routes.js";
import { NAV_GROUPS, NAV_ITEMS, isNavActive } from "../../src/shared/components/nav/navItems.js";

const EXCLUDED_ROUTES = new Set([
  "/",
  "/login",
  "/callback",
  "/dashboard/providers/new",
  "/dashboard/providers/:id",
  "/dashboard/settings/pricing",
]);

describe("navItems", () => {
  it("contains 10 items matching the shell routes minus excluded routes", () => {
    expect(NAV_ITEMS).toHaveLength(10);
    const expectedHrefs = routes
      .map((route) => route.path)
      .filter((path) => !EXCLUDED_ROUTES.has(path))
      .sort();
    expect(NAV_ITEMS.map((item) => item.href).sort()).toEqual(expectedHrefs);
  });

  it("defines 4 groups in the order operate, route, observe, system", () => {
    expect(NAV_GROUPS).toEqual([
      { id: "operate", label: "Operate" },
      { id: "route", label: "Route" },
      { id: "observe", label: "Observe" },
      { id: "system", label: "System" },
    ]);
    const validGroupIds = new Set(NAV_GROUPS.map((group) => group.id));
    for (const item of NAV_ITEMS) {
      expect(validGroupIds.has(item.group)).toBe(true);
    }
  });

  it("marks exactly the 4 primary items with the expected short labels", () => {
    const primary = NAV_ITEMS.filter((item) => item.primary);
    expect(primary).toHaveLength(4);
    expect(
      primary.map(({ href, shortLabel }) => ({ href, shortLabel })).sort((a, b) =>
        a.href.localeCompare(b.href),
      ),
    ).toEqual([
      { href: "/dashboard", shortLabel: "Overview" },
      { href: "/dashboard/endpoint", shortLabel: "Keys" },
      { href: "/dashboard/providers", shortLabel: "Providers" },
      { href: "/dashboard/usage", shortLabel: "Usage" },
    ]);

    for (const item of NAV_ITEMS.filter((entry) => !entry.primary)) {
      expect(item.shortLabel).toBe(item.label);
    }
  });

  it("preserves Sidebar order, labels, and Material Symbols icons", () => {
    expect(NAV_ITEMS.map(({ href, label, icon, group }) => ({ href, label, icon, group }))).toEqual([
      { href: "/dashboard", label: "Overview", icon: "dashboard", group: "operate" },
      { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api", group: "operate" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns", group: "operate" },
      { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers", group: "route" },
      { href: "/dashboard/systemone", label: "System One", icon: "account_tree", group: "route" },
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart", group: "observe" },
      { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage", group: "observe" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings", group: "observe" },
      { href: "/dashboard/console-log", label: "Console Log", icon: "terminal", group: "system" },
      { href: "/dashboard/profile", label: "Settings", icon: "settings", group: "system" },
    ]);
  });

  it("matches /dashboard exactly and all other routes by prefix", () => {
    expect(isNavActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavActive("/dashboard", "/dashboard/usage")).toBe(false);
    expect(isNavActive("/dashboard/providers", "/dashboard/providers/abc")).toBe(true);
    expect(isNavActive("/dashboard/providers", "/dashboard/providers")).toBe(true);
    expect(isNavActive("/dashboard/usage", "/dashboard/quota")).toBe(false);
  });
});
