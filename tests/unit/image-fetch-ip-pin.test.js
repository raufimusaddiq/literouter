import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { vi } from "#test/vi";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...a) => lookupMock(...a) }));

import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let server;
let port;
const seen = [];

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ host: req.headers.get("host"), path: url.pathname + url.search });
      if (url.pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    },
  });
  port = server.port;
});

afterAll(() => { server.stop(true); });

beforeEach(() => {
  seen.length = 0;
  lookupMock.mockReset();
});

describe("fetchImageAsBase64 IP pin", () => {
  it("connects to the validated IP, not a re-resolved one", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = (u, o) => { calls.push(String(u)); return realFetch(String(u).replace("93.184.216.34", "127.0.0.1"), o); };
    try {
      const r = await fetchImageAsBase64(`http://pinned.example:${port}/a.png?x=1`);
      expect(r?.mimeType).toBe("image/png");
    } finally { globalThis.fetch = realFetch; }
    expect(calls).toEqual([`http://93.184.216.34:${port}/a.png?x=1`]);
    expect(seen).toEqual([{ host: `pinned.example:${port}`, path: "/a.png?x=1" }]);
  });

  it("does not re-resolve the hostname when fetching", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (u, o) => realFetch(String(u).replace("93.184.216.34", "127.0.0.1"), o);
    try { await fetchImageAsBase64(`http://pinned.example:${port}/a.png`); } finally { globalThis.fetch = realFetch; }
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("brackets an IPv6 pin", async () => {
    lookupMock.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (u, o) => { calls.push({ u: String(u), o }); return new Response(null, { status: 404 }); };
    try { await fetchImageAsBase64("https://v6.example/a.png"); } finally { globalThis.fetch = realFetch; }
    expect(calls[0].u).toBe("https://[2606:4700:4700::1111]/a.png");
    expect(calls[0].o.headers.Host).toBe("v6.example");
    expect(calls[0].o.tls).toEqual({ serverName: "v6.example" });
  });

  it("does not follow redirects", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (u, o) => realFetch(String(u).replace("93.184.216.34", "127.0.0.1"), o);
    try {
      expect(await fetchImageAsBase64(`http://pinned.example:${port}/redirect`)).toBeNull();
    } finally { globalThis.fetch = realFetch; }
    expect(seen).toHaveLength(1);
  });

  it("rejects when the validated IP is private", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect(await fetchImageAsBase64(`http://pinned.example:${port}/a.png`)).toBeNull();
    expect(seen).toHaveLength(0);
  });
});
