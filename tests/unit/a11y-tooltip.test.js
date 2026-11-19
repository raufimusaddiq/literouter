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

describe("Tooltip Escape", () => {
  const src = read("src/shared/components/Tooltip.js");
  it("stops propagation only while the tooltip is visible", () => {
    expect(src).toMatch(/if \(visible && !dismissed\) e\.stopPropagation\(\)/);
  });
});

describe("CapacityBadges a11y", () => {
  const src = read("src/shared/components/CapacityBadges.js");

  it("focusable mode: focusable trigger with accessible name; icon stays aria-hidden", () => {
    expect(src).toMatch(/focusable = false/);
    expect(src).toMatch(/if \(focusable\)/);
    expect(src).toMatch(/tabIndex=\{0\}/);
    expect(src).toMatch(/aria-label=\{meta\.label\}/);
    expect(src).toMatch(/aria-hidden="true"/);
  });

  it("default mode: sr-only label, no tab stop outside the focusable branch", () => {
    expect(src).toMatch(/<span className="sr-only">\{meta\.label\}<\/span>/);
    const tail = src.slice(src.indexOf("// Non-focusable"));
    expect(tail).not.toMatch(/tabIndex/);
  });

  it("only the provider-detail ModelRow opts in", () => {
    expect(read("src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js")).toMatch(/<CapacityBadges focusable/);
    expect(read("src/shared/components/ModelSelectModal.js")).not.toMatch(/CapacityBadges[^>]*focusable/);
    expect(read("src/app/(dashboard)/dashboard/combos/page.js")).not.toMatch(/CapacityBadges[^>]*focusable/);
  });
});
