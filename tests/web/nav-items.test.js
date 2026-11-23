import { describe, it, expect } from "bun:test";
import { routes } from "../../src/web/routes.js";
import { NAV_ITEMS, isNavActive } from "../../src/shared/components/nav/navItems.js";

const EXCLUDED_ROUTES = new Set([
  "/",
  "/login",
  "/callback",
  "/dashboard/providers/new",
  "/dashboard/providers/:id",
  "/dashboard/settings/pricing",
]);

describe("navItems", () => {
  it("lists every shell route except the excluded ones", () => {
    const expectedHrefs = routes
      .map((route) => route.path)
      .filter((path) => !EXCLUDED_ROUTES.has(path))
      .sort();
    expect(NAV_ITEMS.map((item) => item.href).sort()).toEqual(expectedHrefs);
  });

  it.each([
    ["/dashboard", "/dashboard", true],
    ["/dashboard", "/dashboard/usage", false],
    ["/dashboard/providers", "/dashboard/providers/abc", true],
    ["/dashboard/providers", "/dashboard/providers", true],
    ["/dashboard/usage", "/dashboard/quota", false],
  ])("isNavActive(%s, %s) is %s", (href, pathname, expected) => {
    expect(isNavActive(href, pathname)).toBe(expected);
  });
});
