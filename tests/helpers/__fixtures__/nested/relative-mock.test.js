import { describe, it, expect } from "bun:test";
import { vi } from "#test/vi";

vi.mock("../dep.js", () => ({ dep: () => "mocked-nested" }));

describe("nested relative mock", () => {
  it("relative vi.mock from a nested dir resolves against the caller", async () => {
    const { useDep } = await import("../user.js");
    expect(useDep()).toBe("mocked-nested");
  });
});
