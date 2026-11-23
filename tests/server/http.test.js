import { describe, expect, test } from "bun:test";
import { cookies, json, nextUrl, redirect, serializeCookie, applyCookies } from "../../src/server/http.js";
import { toBunHandler } from "../../src/server/adapter.js";

describe("http helpers", () => {
  test("json matches NextResponse.json", async () => {
    const res = json({ a: 1 }, { status: 201, headers: { "x-test": "y" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-test")).toBe("y");
    expect(await res.text()).toBe('{"a":1}');
  });

  test("Response.json answers application/json without a charset, as Node does", async () => {
    const res = Response.json({ a: 1 }, { status: 404 });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });

  test("Response.json keeps a content-type the handler set", () => {
    const res = Response.json({ a: 1 }, { headers: { "content-type": "application/problem+json" } });
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const explicit = Response.json({ a: 1 }, { headers: { "content-type": "application/json; charset=utf-8" } });
    expect(explicit.headers.get("content-type")).toBe("application/json; charset=utf-8");
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
        "/": toBunHandler(async () => ({
          GET: (req) => {
            const jar = cookies(req);
            const seen = jar.get("a");
            jar.set("out", "v");
            return new Response(seen);
          },
        })),
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

  test("serializeCookie matches the Next ResponseCookies attribute order", () => {
    const at = new Date("2030-01-02T03:04:05Z").getTime();
    const realNow = Date.now;
    Date.now = () => at;
    try {
      expect(
        serializeCookie("t", "v 1", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 86400 }),
      ).toBe("t=v%201; Path=/; Expires=Thu, 03 Jan 2030 03:04:05 GMT; Max-Age=86400; Secure; HttpOnly; SameSite=lax");
    } finally {
      Date.now = realNow;
    }
    expect(serializeCookie("a", "b")).toBe("a=b; Path=/");
    expect(serializeCookie("a", "b", { domain: "x.test", path: "/p" })).toBe("a=b; Path=/p; Domain=x.test");
  });

  test("cookies().delete expires the cookie on Path=/ and forgets the value", () => {
    const req = new Request("http://h.test/", { headers: { cookie: "auth_token=abc; other=1" } });
    const jar = cookies(req);
    expect(jar.get("auth_token")).toBe("abc");
    jar.delete("auth_token");
    expect(jar.get("auth_token")).toBeNull();
    expect(jar.toSetCookieHeaders()).toEqual(["auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
  });

  test("cookies(req) is one jar per request and the last write to a name wins", () => {
    const req = new Request("http://h.test/");
    cookies(req).set("a", "1");
    cookies(req).set("a", "2");
    expect(cookies(req).toSetCookieHeaders()).toEqual(["a=2; Path=/"]);
  });

  test("applyCookies appends to mutable and immutable responses and leaves clean ones alone", () => {
    const req = new Request("http://h.test/");
    const clean = new Response("x");
    expect(applyCookies(req, clean)).toBe(clean);
    cookies(req).set("a", "1");
    cookies(req).set("b", "2");
    const mutable = applyCookies(req, new Response("x"));
    expect(mutable.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    const frozen = Response.redirect("http://h.test/next", 302);
    const copy = applyCookies(req, frozen);
    expect(copy.status).toBe(302);
    expect(copy.headers.get("location")).toBe("http://h.test/next");
    expect(copy.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});
