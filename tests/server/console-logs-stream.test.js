import { describe, expect, test } from "bun:test";

const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
const { GET } = await import("@/app/api/console-logs/stream/route.js");

initConsoleLogCapture();

function frames(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seen = [];
  let buffer = "";
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (block.startsWith("data: ")) seen.push(JSON.parse(block.slice(6)));
      }
    }
  })();
  return { seen, stop: () => reader.cancel().then(() => pump.catch(() => {})) };
}

describe("console log stream", () => {
  test("a line already in the init snapshot is not sent again in the next lines frame", async () => {
    const marker = `snapshot-line-${Date.now()}`;
    console.log(marker);
    const controller = new AbortController();
    const stream = frames(await GET(new Request("http://x.test/api/console-logs/stream", { signal: controller.signal })));
    await Bun.sleep(300);
    expect(stream.seen.map((f) => f.type)).toEqual(["init"]);
    expect(stream.seen[0].logs.some((l) => l.includes(marker))).toBe(true);
    controller.abort();
    await stream.stop();
  });

  test("lines logged after the stream opened arrive in a lines frame without the snapshot lines", async () => {
    const before = `before-${Date.now()}`;
    const after = `after-${Date.now()}`;
    console.log(before);
    const controller = new AbortController();
    const stream = frames(await GET(new Request("http://x.test/api/console-logs/stream", { signal: controller.signal })));
    await Bun.sleep(20);
    console.log(after);
    await Bun.sleep(300);
    const types = stream.seen.map((f) => f.type);
    expect(types).toEqual(["init", "lines"]);
    expect(stream.seen[1].lines).toEqual([after]);
    controller.abort();
    await stream.stop();
  });
});
