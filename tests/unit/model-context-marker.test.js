
import { describe, it, expect } from "bun:test";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";

describe("model context marker", () => {
  it("strips the [1m] marker and reports it", () => {
    expect(stripModelContextMarker("claude-opus-5[1m]")).toEqual({
      model: "claude-opus-5",
      contextMarker: "1m",
    });
  });

  it("strips it from a provider-prefixed model too", () => {
    expect(stripModelContextMarker("cc/claude-sonnet-4.5[1m]")).toEqual({
      model: "cc/claude-sonnet-4.5",
      contextMarker: "1m",
    });
  });

  it("is case insensitive", () => {
    expect(stripModelContextMarker("claude-opus-5[1M]").model).toBe("claude-opus-5");
  });

  it("leaves a plain model untouched", () => {
    expect(stripModelContextMarker("claude-opus-5")).toEqual({
      model: "claude-opus-5",
      contextMarker: null,
    });
  });

  it("only strips a trailing marker, never one inside the name", () => {
    expect(stripModelContextMarker("weird[1m]name")).toEqual({
      model: "weird[1m]name",
      contextMarker: null,
    });
  });

  it("tolerates a non-string model", () => {
    expect(stripModelContextMarker(undefined)).toEqual({ model: undefined, contextMarker: null });
  });
});
