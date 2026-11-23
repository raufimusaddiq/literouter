import { describe, it, expect } from "bun:test";
import { routes, findRoute } from "../../src/web/routes.js";

const URLS = [
  "/",
  "/callback",
  "/dashboard",
  "/dashboard/combos",
  "/dashboard/console-log",
  "/dashboard/endpoint",
  "/dashboard/profile",
  "/dashboard/providers",
  "/dashboard/providers/:id",
  "/dashboard/providers/new",
  "/dashboard/quota",
  "/dashboard/settings/pricing",
  "/dashboard/systemone",
  "/dashboard/token-saver",
  "/dashboard/usage",
  "/login",
];

const NO_SHELL = ["/login", "/callback", "/dashboard/settings/pricing"];

describe("routes", () => {
  it("covers the 16 URLs", () => {
    expect(routes.map((r) => r.path).sort()).toEqual([...URLS].sort());
  });

  it("findRoute resolves in order and rejects unknown paths", () => {
    expect(findRoute("/dashboard/providers/new").route.path).toBe("/dashboard/providers/new");
    expect(findRoute("/dashboard/providers/new").params).toEqual({});
    expect(findRoute("/dashboard/providers/openai").params.id).toBe("openai");
    expect(findRoute("/dashboard/nope")).toBeNull();
    expect(findRoute("/dashboard/providers/a/b")).toBeNull();
  });

  it("findRoute resolves against a given list instead of the route table", () => {
    const list = [
      { path: "/only", load: () => null, shell: false },
      { path: "/item/:id", load: () => null, shell: false },
    ];
    expect(findRoute("/only", list).route).toBe(list[0]);
    expect(findRoute("/item/7", list).params).toEqual({ id: "7" });
    expect(findRoute("/dashboard", list)).toBeNull();
  });

  it("flags the shell correctly", () => {
    for (const path of NO_SHELL) {
      expect(findRoute(path).route.shell).toBe(false);
    }
    for (const route of routes) {
      if (route.redirect || NO_SHELL.includes(route.path)) continue;
      expect(route.shell).toBe(true);
      expect(typeof route.load).toBe("function");
    }
    expect(findRoute("/").route).toEqual({ path: "/", redirect: "/dashboard" });
  });
});
