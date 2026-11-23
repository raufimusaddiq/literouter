import { describe, it, expect } from "bun:test";
import { nextTrapTarget } from "@/shared/utils/focusTrap.js";

describe("nextTrapTarget", () => {
  const [a, b, c] = ["a", "b", "c"];
  const list = [a, b, c];
  it("wraps forward from last to first", () => expect(nextTrapTarget(list, c, false)).toBe(a));
  it("wraps backward from first to last", () => expect(nextTrapTarget(list, a, true)).toBe(c));
  it("lets the browser handle middle elements", () => {
    expect(nextTrapTarget(list, b, false)).toBeNull();
    expect(nextTrapTarget(list, b, true)).toBeNull();
  });
  it("pulls outside focus back in", () => {
    expect(nextTrapTarget(list, "x", false)).toBe(a);
    expect(nextTrapTarget(list, "x", true)).toBe(c);
  });
  it("returns null for an empty list", () => expect(nextTrapTarget([], null, false)).toBeNull());
});
