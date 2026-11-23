import { describe, expect, test } from "bun:test";

const { parseCommand, awaitTrayRuntime } = require("../src/cli/utils/launch");

describe("parseCommand", () => {
  test("stop as the first argument", () => {
    expect(parseCommand(["stop"]).command).toBe("stop");
  });

  test("stop after flags", () => {
    expect(parseCommand(["--skip-update", "stop"]).command).toBe("stop");
    expect(parseCommand(["-n", "--log", "stop"]).command).toBe("stop");
  });

  test("flag values are not commands", () => {
    expect(parseCommand(["--port", "8080"]).command).toBeNull();
    expect(parseCommand(["-H", "127.0.0.1", "stop"]).command).toBe("stop");
  });

  test("xai video keeps its remaining args", () => {
    const parsed = parseCommand(["xai", "video", "--prompt", "x"]);
    expect(parsed.command).toBe("xai");
    expect(parsed.rest).toEqual(["video", "--prompt", "x"]);
  });

  test("no command", () => {
    expect(parseCommand(["--skip-update"]).command).toBeNull();
    expect(parseCommand([]).command).toBeNull();
  });
});

describe("awaitTrayRuntime", () => {
  test("windows does not wait", async () => {
    let called = false;
    const ok = await awaitTrayRuntime({ platform: "win32", runtime: () => (called = true) });
    expect(ok).toBe(true);
    expect(called).toBe(false);
  });

  test("linux waits for a successful install", async () => {
    const logs = [];
    const ok = await awaitTrayRuntime({ platform: "linux", runtime: async () => ({ ok: true }), log: (l) => logs.push(l) });
    expect(ok).toBe(true);
    expect(logs).toEqual([]);
  });

  test("ready runtime is fine", async () => {
    expect(await awaitTrayRuntime({ platform: "darwin", runtime: async () => ({ skipped: "ready" }) })).toBe(true);
  });

  test("failure logs one line mentioning stop", async () => {
    const logs = [];
    const ok = await awaitTrayRuntime({ platform: "darwin", runtime: async () => ({ ok: false, reason: "offline" }), log: (l) => logs.push(l) });
    expect(ok).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("literouter stop");
  });

  test("timeout logs one line and returns", async () => {
    const logs = [];
    const ok = await awaitTrayRuntime({
      platform: "linux",
      timeoutMs: 20,
      runtime: () => new Promise(() => {}),
      log: (l) => logs.push(l),
    });
    expect(ok).toBe(false);
    expect(logs).toHaveLength(1);
  });

  test("a throwing runtime is treated as unavailable", async () => {
    const logs = [];
    const ok = await awaitTrayRuntime({ platform: "linux", runtime: async () => { throw new Error("x"); }, log: (l) => logs.push(l) });
    expect(ok).toBe(false);
    expect(logs).toHaveLength(1);
  });
});
