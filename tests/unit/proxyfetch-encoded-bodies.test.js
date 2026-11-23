import { describe, it, expect, afterAll } from "bun:test";
import zlib from "node:zlib";

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const patchedFetch = (await import("../../open-sse/utils/proxyFetch.js")).default;

const json = JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { role: "assistant", content: "héllo ".repeat(500) } }] });
const frames = [
  ...Array.from({ length: 6 }, (_, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: `tok${i} ✓` } }] })}\n\n`),
  "data: [DONE]\n\n",
];
const sse = frames.join("");
const codecs = { gzip: zlib.gzipSync, deflate: zlib.deflateSync };
const seenAccept = [];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    const [, encoding, kind] = url.pathname.split("/");
    seenAccept.push(req.headers.get("accept-encoding"));
    const encode = codecs[encoding];
    if (kind === "json") {
      return new Response(encode(json), { headers: { "content-type": "application/json", "content-encoding": encoding } });
    }
    const compressed = encode(sse);
    const mid = Math.floor(compressed.length / 2);
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(compressed.subarray(0, mid));
        await new Promise((r) => setTimeout(r, 30));
        controller.enqueue(compressed.subarray(mid));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "content-encoding": encoding } });
  },
});
const base = `http://127.0.0.1:${server.port}`;
afterAll(() => server.stop(true));

for (const [name, doFetch] of [["proxyAwareFetch", proxyAwareFetch], ["patched global fetch", patchedFetch]]) {
  describe(`${name} decodes encoded upstream bodies with the explicit accept-encoding`, () => {
    for (const encoding of ["gzip", "deflate"]) {
      it(`${encoding} JSON body`, async () => {
        const res = await doFetch(`${base}/${encoding}/json`, { method: "POST", body: "{}" });
        expect(seenAccept.at(-1)).toBe("gzip, deflate");
        expect(await res.text()).toBe(json);
      });

      it(`${encoding} SSE body arrives intact frame by frame`, async () => {
        const res = await doFetch(`${base}/${encoding}/sse`, { method: "POST", body: "{}" });
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const decoder = new TextDecoder();
        let text = "";
        for await (const chunk of res.body) text += decoder.decode(chunk, { stream: true });
        expect(text).toBe(sse);
        const received = text.split("\n\n").filter(Boolean).map((f) => f + "\n\n");
        expect(received).toEqual(frames);
        expect(received.at(-1)).toBe("data: [DONE]\n\n");
      });
    }
  });
}
