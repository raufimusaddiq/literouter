import { describe, it, expect } from "bun:test";
import { computeRouteLinks } from "../../src/web/pages/dashboard/overview/routeLinks.js";

describe("computeRouteLinks", () => {
  it("maps each request to the first matching provider row and counts visible hits", () => {
    const result = computeRouteLinks(
      [{ provider: "cc" }, { provider: "kn" }, { provider: "zz" }],
      [{ provider: "kn" }, { provider: "cc" }, { provider: "cc" }],
    );

    expect(result).toEqual({
      links: [
        { from: 0, to: 1 },
        { from: 1, to: 0 },
        { from: 2, to: null },
      ],
      hits: new Map([
        ["cc", 1],
        ["kn", 1],
        ["zz", 1],
      ]),
      newest: 0,
    });
  });

  it("returns empty links, empty hits map, and null newest for empty inputs", () => {
    expect(computeRouteLinks([], [])).toEqual({
      links: [],
      hits: new Map(),
      newest: null,
    });
  });

  it("aggregates multiple hits per provider and points only to the first matching row", () => {
    const result = computeRouteLinks(
      [
        { provider: "cc" },
        { provider: "kn" },
        { provider: "cc" },
        { provider: "cc" },
        { provider: "kn" },
      ],
      [
        { provider: "ts" },
        { provider: "kn" },
        { provider: "cc" },
        { provider: "cc" },
      ],
    );

    expect(result.links).toEqual([
      { from: 0, to: 2 },
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 2 },
      { from: 4, to: 1 },
    ]);
    expect(result.hits).toEqual(new Map([["cc", 3], ["kn", 2]]));
    expect(result.newest).toBe(0);
  });

  it("sets to null when there are requests but no visible provider rows", () => {
    const result = computeRouteLinks([{ provider: "cc" }], []);
    expect(result).toEqual({
      links: [{ from: 0, to: null }],
      hits: new Map([["cc", 1]]),
      newest: 0,
    });
  });
});
