import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("advanceTimersByTimeAsync jumps 1h quickly and respects the window end", async () => {
    vi.useFakeTimers();
    const fired = [];
    setTimeout(() => fired.push("59m"), 59 * 60_000);
    setTimeout(() => fired.push("61m"), 61 * 60_000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fired).toEqual(["59m"]);
  }, 1000); // fake timers freeze every clock, so the per-test 1s timeout is the "fast" assertion

  it("advanceTimersByTimeAsync fires a timer due exactly at the window end", async () => {
    vi.useFakeTimers();
    const fired = [];
    setTimeout(() => fired.push("edge"), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toEqual(["edge"]);
  });

  it("advanceTimersByTimeAsync fires a mid-window-created timer due exactly at the window end", async () => {
    vi.useFakeTimers();
    const fired = [];
    setTimeout(async () => {
      await Promise.resolve();
      setTimeout(() => fired.push("end"), 500);
    }, 500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toEqual(["end"]);
  });

  it("advanceTimersByTimeAsync floors fractional ms and never over-advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await vi.advanceTimersByTimeAsync(10.9); // Bun timers are integer ms: floored to 10
    expect(Date.now()).toBe(1_000_010);
    await vi.advanceTimersByTimeAsync(0.5);
    expect(Date.now()).toBe(1_000_010);
  });

  it("setSystemTime + advanceTimersByTimeAsync advances Date.now by exactly the amount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2021-06-01T00:00:00Z"));
    const start = Date.now();
    setTimeout(() => {}, 250);
    await vi.advanceTimersByTimeAsync(1234);
    expect(Date.now() - start).toBe(1234);
  });

  it("isolation pin actually runs (not skipped) under bun test --parallel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vi-pin-"));
    const out = join(dir, "junit.xml");
    try {
      // Explicit fixture paths only, so the child never collects vi.test.js (no recursion).
      const proc = Bun.spawn(
        ["bun", "test", "--parallel", "helpers/__fixtures__/isolation.test.js",
         "helpers/__fixtures__/nested/relative-mock.test.js",
         "--reporter=junit", `--reporter-outfile=${out}`],
        { cwd: resolve(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore" },
      );
      expect(await proc.exited).toBe(0);
      const xml = readFileSync(out, "utf8");
      const cases = xml.split("<testcase").slice(1);
      const iso = cases.filter((c) => c.includes("dep.js is not mocked"));
      const rel = cases.filter((c) => c.includes("relative vi.mock from a nested dir"));
      expect(iso.length).toBe(1);
      expect(rel.length).toBe(1);
      expect(cases.filter((c) => /<skipped|<failure|<error/.test(c)).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
