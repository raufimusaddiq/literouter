// #147: retention must be an explicit, bounded, env-pinnable number.
import { describe, it, expect } from "vitest";
import { resolveMaxRecords } from "@/lib/db/repos/requestDetailsRepo.js";

describe("resolveMaxRecords", () => {
  it("defaults to 15000 (~33 h at 11k req/day), not 200", () => {
    expect(resolveMaxRecords({}, {})).toBe(15000);
  });
  it("env wins over a stale stored setting", () => {
    expect(resolveMaxRecords({ observabilityMaxRecords: 200 }, { OBSERVABILITY_MAX_RECORDS: "20000" })).toBe(20000);
  });
  it("falls back to the stored setting, then the default, on bad env", () => {
    expect(resolveMaxRecords({ observabilityMaxRecords: 500 }, {})).toBe(500);
    expect(resolveMaxRecords({ observabilityMaxRecords: 500 }, { OBSERVABILITY_MAX_RECORDS: "abc" })).toBe(500);
    expect(resolveMaxRecords({ observabilityMaxRecords: 0 }, { OBSERVABILITY_MAX_RECORDS: "-5" })).toBe(15000);
  });
  it("clamps to the ceiling", () => {
    expect(resolveMaxRecords({}, { OBSERVABILITY_MAX_RECORDS: "99999999" })).toBe(100000);
  });
});
