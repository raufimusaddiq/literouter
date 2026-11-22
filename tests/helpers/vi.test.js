import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";

vi.mock("./__fixtures__/dep.js", () => ({ dep: () => "mocked" }));

describe("vi helper", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hoisted returns factory value", () => {
    expect(vi.hoisted(() => 42)).toBe(42);
  });

  it("resetModules gives a fresh module instance and keeps mocks", async () => {
    const a = await import("./__fixtures__/counter.js");
    a.inc(); a.inc();
    expect(a.n).toBe(2);
    vi.resetModules();
    const b = await import("./__fixtures__/counter.js");
    expect(b.n).toBe(0);
    const { useDep } = await import("./__fixtures__/user.js");
    expect(useDep()).toBe("mocked");
  });

  it("advanceTimersByTimeAsync runs timers scheduled from awaited callbacks", async () => {
    vi.useFakeTimers();
    const fired = [];
    setTimeout(async () => {
      fired.push("a");
      await Promise.resolve();
      setTimeout(() => fired.push("b"), 400);
    }, 500);
    setTimeout(() => fired.push("late"), 1001);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toEqual(["a", "b", "late"]);
  });

  it("setSystemTime sets Date.now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    expect(Date.now()).toBe(Date.parse("2020-01-01T00:00:00Z"));
  });

  it("stubEnv/unstubAllEnvs restore set and unset vars", () => {
    process.env.__VI_SET = "orig";
    delete process.env.__VI_UNSET;
    vi.stubEnv("__VI_SET", "changed");
    vi.stubEnv("__VI_UNSET", "x");
    expect(process.env.__VI_SET).toBe("changed");
    expect(process.env.__VI_UNSET).toBe("x");
    vi.stubEnv("__VI_SET", undefined);
    expect("__VI_SET" in process.env).toBe(false);
    vi.unstubAllEnvs();
    expect(process.env.__VI_SET).toBe("orig");
    expect("__VI_UNSET" in process.env).toBe(false);
    delete process.env.__VI_SET;
  });

  it("stubGlobal/unstubAllGlobals restore descriptors", () => {
    const orig = globalThis.fetch;
    const fake = () => "fake";
    vi.stubGlobal("fetch", fake);
    expect(globalThis.fetch).toBe(fake);
    vi.stubGlobal("__vi_new_global", 5);
    expect(globalThis.__vi_new_global).toBe(5);
    vi.unstubAllGlobals();
    expect(globalThis.fetch).toBe(orig);
    expect("__vi_new_global" in globalThis).toBe(false);
  });

  it("mocked returns its argument", () => {
    const f = vi.fn();
    expect(vi.mocked(f)).toBe(f);
  });

  it("waitFor retries until success and rethrows after timeout", async () => {
    let calls = 0;
    const v = await vi.waitFor(() => { if (++calls < 3) throw new Error("no"); return "ok"; }, { interval: 5 });
    expect(v).toBe("ok");
    await expect(vi.waitFor(() => { throw new Error("always"); }, { timeout: 40, interval: 5 })).rejects.toThrow("always");
  });

  it("keeps bun's own function references", async () => {
    const bun = (await import("bun:test")).vi;
    for (const k of ["mock", "fn", "spyOn", "useFakeTimers", "clearAllMocks"]) expect(vi[k]).toBe(bun[k]);
  });
});
