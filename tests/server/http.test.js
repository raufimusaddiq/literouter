import { describe, expect, test } from "bun:test";
import { cookies, json, nextUrl, redirect } from "../../src/server/http.js";

describe("http helpers", () => {
  test("json matches NextResponse.json", async () => {
    const res = json({ a: 1 }, { status: 201, headers: { "x-test": "y" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json;charset=utf-8");
    expect(res.headers.get("x-test")).toBe("y");
    expect(await res.text()).toBe('{"a":1}');
  });

  test("json keeps a caller supplied content-type", () => {
    const res = json({ a: 1 }, { headers: { "Content-Type": "application/problem+json" } });
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  test("redirect rejects a relative target without a base", () => {
    expect(() => redirect("/login")).toThrow();
  });

  test("redirect resolves a relative target and defaults to 307", () => {
    const res = redirect(new URL("/login", "http://h.test/a/b"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://h.test/login");
    const rel = redirect("/x", 302, "http://h.test/a");
    expect(rel.status).toBe(302);
    expect(rel.headers.get("location")).toBe("http://h.test/x");
  });

  test("nextUrl returns the parsed URL with searchParams", () => {
    const url = nextUrl(new Request("http://h.test/p?a=1&b=2"));
    expect(url.pathname).toBe("/p");
    expect(url.searchParams.get("b")).toBe("2");
  });

  test("cookies reads the Cookie header and, on a Bun request, sets Set-Cookie", async () => {
    const plain = cookies(new Request("http://h.test/", { headers: { cookie: "a=1; b=2" } }));
    expect(plain.get("b")).toBe("2");
    const server = Bun.serve({
      port: 0,
      routes: {
        "/": (req) => {
          const jar = cookies(req);
          const seen = jar.get("a");
          jar.set("out", "v");
          return new Response(seen);
        },
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { cookie: "a=hello" } });
      expect(await res.text()).toBe("hello");
      expect(res.headers.get("set-cookie")).toContain("out=v");
    } finally {
      server.stop(true);
    }
  });
});
