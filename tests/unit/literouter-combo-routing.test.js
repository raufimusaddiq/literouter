import { describe, expect, it, beforeEach } from "vitest";
import {
  getRotatedModels,
  resetComboRotation,
  reorderByCapabilities,
} from "../../open-sse/services/combo.js";

// Deterministic routing fixtures for the LiteRouter minimal profile.
// These replace the two stale assertions in combo-autoswitch.test.js that
// assume capability auto-switch still ranks `search` (disabled upstream) and
// compare array identity with `toBe`.

describe("combo rotation (round-robin)", () => {
  beforeEach(() => resetComboRotation("rr"));

  it("advances the cursor across successive calls", () => {
    const models = ["a/1", "b/2", "c/3"];
    const first = getRotatedModels(models, "rr", "round-robin", 1)[0];
    const second = getRotatedModels(models, "rr", "round-robin", 1)[0];
    const third = getRotatedModels(models, "rr", "round-robin", 1)[0];
    expect([first, second, third]).toEqual(["a/1", "b/2", "c/3"]);
  });

  it("returns every model so fallback order is preserved", () => {
    const models = ["a/1", "b/2", "c/3"];
    const rotated = getRotatedModels(models, "rr", "round-robin", 1);
    expect(rotated).toHaveLength(3);
    expect([...rotated].sort()).toEqual([...models].sort());
  });

  it("sticky limit keeps the same head across calls", () => {
    const models = ["a/1", "b/2", "c/3"];
    const head = getRotatedModels(models, "sticky", "round-robin", 5)[0];
    for (let i = 0; i < 4; i++) {
      expect(getRotatedModels(models, "sticky", "round-robin", 5)[0]).toBe(head);
    }
  });
});

describe("combo capability ordering", () => {
  it("returns the same list instance when nothing is required", () => {
    const models = ["a/x", "b/y"];
    expect(reorderByCapabilities(models, new Set())).toBe(models);
  });

  it("keeps original order when no model satisfies a hard capability", () => {
    const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
    expect(reorderByCapabilities(models, new Set(["vision"]))).toEqual(models);
  });

  it("never drops a fallback candidate", () => {
    const models = ["deepseek/deepseek-chat", "anthropic/claude-sonnet-4.6"];
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out).toHaveLength(models.length);
    expect([...out].sort()).toEqual([...models].sort());
  });
});
