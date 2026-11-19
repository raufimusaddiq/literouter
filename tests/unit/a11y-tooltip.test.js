import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

describe("Tooltip a11y", () => {
  const src = read("src/shared/components/Tooltip.js");

  it("tooltip element has role=tooltip and an id linked via aria-describedby", () => {
    expect(src).toMatch(/role="tooltip"/);
    expect(src).toMatch(/useId\(\)/);
    expect(src).toMatch(/"aria-describedby"/);
  });

  it("shows on keyboard focus and closes on Escape", () => {
    expect(src).toMatch(/group-focus-within\/tt:opacity-100/);
    expect(src).toMatch(/e\.key === "Escape"/);
  });

  it("is the only place using the group/tt pattern", () => {
    expect(read("src/shared/components/CapacityBadges.js")).not.toMatch(/group\/tt/);
  });
});

describe("CapacityBadges a11y", () => {
  const src = read("src/shared/components/CapacityBadges.js");

  it("trigger is focusable with an accessible name; icon stays aria-hidden", () => {
    expect(src).toMatch(/tabIndex=\{0\}/);
    expect(src).toMatch(/aria-label=\{CAPACITY_META\[k\]\.label\}/);
    expect(src).toMatch(/aria-hidden="true"/);
  });
});
