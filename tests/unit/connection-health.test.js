import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyConnection, getConnectionHealthStats } from "@/shared/utils/connectionHealth.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const future = new Date(NOW + 60000).toISOString();
const past = new Date(NOW - 60000).toISOString();

describe("classifyConnection", () => {
  it("active + passing is ready", () => {
    expect(classifyConnection({ isActive: true, testStatus: "success" }, NOW).status).toBe("ready");
  });
  it("active + error needs attention", () => {
    expect(classifyConnection({ testStatus: "error" }, NOW)).toEqual({ status: "attention", reason: "error" });
  });
  it("cooldown and rate limit need attention; ended cooldown is ready", () => {
    expect(classifyConnection({ testStatus: "unavailable", modelLock_x: future }, NOW).reason).toBe("cooldown");
    expect(classifyConnection({ testStatus: "active", rateLimitedUntil: future }, NOW).reason).toBe("rate_limited");
    expect(classifyConnection({ testStatus: "unavailable", modelLock_x: past }, NOW).status).toBe("ready");
  });
  it("disabled is inactive even when erroring", () => {
    expect(classifyConnection({ isActive: false, testStatus: "error" }, NOW).status).toBe("inactive");
  });
  it("never tested is ready (untested)", () => {
    expect(classifyConnection({}, NOW)).toEqual({ status: "ready", reason: "untested" });
  });
});

describe("getConnectionHealthStats", () => {
  it("ready + attention + inactive === total", () => {
    const s = getConnectionHealthStats(
      [{ testStatus: "success" }, { testStatus: "error" }, { isActive: false, testStatus: "error" }, {}],
      NOW,
    );
    expect(s).toMatchObject({ total: 4, ready: 2, attention: 1, inactive: 1 });
    expect(s.ready + s.attention + s.inactive).toBe(s.total);
    expect(s.attentionItems).toHaveLength(1);
  });
  it("both pages use the shared function", () => {
    const root = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard");
    for (const f of ["DashboardOverview.js", "providers/page.js"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8")).toContain("getConnectionHealthStats(");
    }
  });
});
