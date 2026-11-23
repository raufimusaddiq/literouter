import { afterEach, describe, expect, test } from "bun:test";
import { isLongLived, toBunHandler } from "../../src/server/adapter.js";

const servers = [];
afterEach(() => {
  while (servers.length) servers.pop().stop(true);
});

function serve(routes) {
  const server = Bun.serve({ port: 0, routes, fetch: () => new Response("nf", { status: 404 }) });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

const ok = () => new Response("ok");

async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

describe("toBunHandler", () => {
  test("params arrive as a Promise of decoded strings", async () => {
    let seen;
    const base = serve({
      "/k/:id": toBunHandler(async () => ({
        GET: async (req, ctx) => {
          expect(ctx.params).toBeInstanceOf(Promise);
          seen = await ctx.params;
          return new Response("ok");
        },
      })),
    });
    await fetch(`${base}/k/a%20b`);
    expect(seen).toEqual({ id: "a b" });
  });

  test("catch-all params are a string[]", async () => {
    let seen;
    const route = { path: "/m/*", catchAll: "model" };
    const base = serve({
      "/m/*": toBunHandler(
        async () => ({
          GET: async (req, ctx) => {
            seen = await ctx.params;
            return new Response("ok");
          },
        }),
        route,
      ),
    });
    await fetch(`${base}/m/a/b%20c`);
    expect(seen).toEqual({ model: ["a", "b c"] });
  });

  test("405 with Allow for a missing method", async () => {
    const base = serve({ "/x": toBunHandler(async () => ({ GET: ok })) });
    const res = await fetch(`${base}/x`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
  });

  test("auto OPTIONS returns 204 with Allow", async () => {
    const base = serve({ "/x": toBunHandler(async () => ({ GET: ok, POST: ok })) });
    const res = await fetch(`${base}/x`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const allow = res.headers.get("allow");
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
    expect(allow).toContain("OPTIONS");
  });

  test("HEAD runs GET and drops the body", async () => {
    let calls = 0;
    const base = serve({
      "/x": toBunHandler(async () => ({
        GET: () => {
          calls++;
          return new Response("payload", { headers: { "x-h": "1" } });
        },
      })),
    });
    const res = await fetch(`${base}/x`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-h")).toBe("1");
    expect(await res.text()).toBe("");
    expect(calls).toBe(1);
  });

  test("a throwing handler returns 500 and the server keeps serving", async () => {
    const base = serve({
      "/boom": toBunHandler(async () => ({
        GET: () => {
          throw new Error("x");
        },
      })),
      "/fine": toBunHandler(async () => ({ GET: ok })),
    });
    await quietly(async () => {
      const res = await fetch(`${base}/boom`);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("");
    });
    expect((await fetch(`${base}/fine`)).status).toBe(200);
  });

  test("a handler returning undefined returns 500", async () => {
    const base = serve({ "/u": toBunHandler(async () => ({ GET: () => undefined })) });
    await quietly(async () => {
      expect((await fetch(`${base}/u`)).status).toBe(500);
    });
  });

  test("long-lived paths call server.timeout(req, 0), others do not", async () => {
    const calls = [];
    const fake = { timeout: (req, s) => calls.push([new URL(req.url).pathname, s]) };
    const h = toBunHandler(async () => ({ GET: ok }));
    await h(new Request("http://h.test/api/v1/chat/completions"), fake);
    await h(new Request("http://h.test/api/providers"), fake);
    expect(calls).toEqual([["/api/v1/chat/completions", 0]]);
    expect(isLongLived("/v1/models")).toBe(true);
    expect(isLongLived("/responses")).toBe(true);
    expect(isLongLived("/api/pxpipe/start")).toBe(true);
    expect(isLongLived("/api/settings")).toBe(false);
  });

  test("cookies set on req.cookies reach the client", async () => {
    const base = serve({
      "/c": toBunHandler(async () => ({
        GET: (req) => {
          req.cookies.set("sid", "abc");
          return new Response("ok");
        },
      })),
    });
    const res = await fetch(`${base}/c`);
    expect(res.headers.get("set-cookie")).toContain("sid=abc");
  });

  test("gzips large responses it returns", async () => {
    const h = toBunHandler(async () => ({ GET: () => Response.json({ d: "x".repeat(4000) }) }));
    const res = await h(new Request("http://h.test/g", { headers: { "accept-encoding": "gzip" } }), null);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });
});
