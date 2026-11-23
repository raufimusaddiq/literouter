import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mockBootCollaborators } from "../helpers/bootMocks.js";

const calls = mockBootCollaborators();
const { runBootOnce } = await import("../../src/server/boot.js");

describe("runBootOnce", () => {
  beforeEach(() => {
    delete globalThis.__lrBoot;
    for (const fn of Object.values(calls)) fn.mockReset();
  });

  afterEach(() => {
    delete globalThis.__lrBoot;
  });

  it("runs each step exactly once across repeated and concurrent calls", async () => {
    await Promise.all([runBootOnce(), runBootOnce(), runBootOnce()]);
    await runBootOnce();
    await runBootOnce();

    expect(calls.warn).toHaveBeenCalledTimes(1);
    expect(calls.consoleCapture).toHaveBeenCalledTimes(1);
    expect(calls.catalog).toHaveBeenCalledTimes(1);
    expect(calls.modelSync).toHaveBeenCalledTimes(1);
    expect(calls.kenariSync).toHaveBeenCalledTimes(1);
    expect(calls.bootstrap).toHaveBeenCalledTimes(1);
    expect(calls.outboundProxy).toHaveBeenCalledTimes(1);
  });

  it("a failing step does not prevent the others, and is logged", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      calls.catalog.mockImplementation(() => {
        throw new Error("catalog boom");
      });
      await expect(runBootOnce()).resolves.toBeUndefined();

      expect(calls.warn).toHaveBeenCalledTimes(1);
      expect(calls.consoleCapture).toHaveBeenCalledTimes(1);
      expect(calls.modelSync).toHaveBeenCalledTimes(1);
      expect(calls.kenariSync).toHaveBeenCalledTimes(1);
      const logged = errors.mock.calls.flat().map((a) => String(a?.message ?? a)).join("\n");
      expect(logged).toContain("catalog boom");
    } finally {
      errors.mockRestore();
    }
  });
});
