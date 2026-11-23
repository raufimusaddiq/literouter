import { describe, it, expect } from "bun:test";
import { mapUsageToKeys } from "../../src/lib/keyUsage.js";
import { fingerprintKey } from "../../open-sse/utils/keyFingerprint.js";

const keys = [
  { id: "k1", key: "sk-aaaaaaaaaaaaaaaa1111", name: "A" },
  { id: "k2", key: "sk-bbbbbbbbbbbbbbbb2222", name: "B" },
];

describe("mapUsageToKeys", () => {
  it("joins usage rows to keys by fingerprint and keys the result by id", () => {
    const rows = [{ apiKey: fingerprintKey(keys[0].key), requests24h: 7, lastUsed: "2026-01-01T00:00:00.000Z" }];
    expect(mapUsageToKeys(keys, rows)).toEqual({
      k1: { requests24h: 7, lastUsed: "2026-01-01T00:00:00.000Z" },
      k2: { requests24h: 0, lastUsed: null },
    });
  });
  it("never leaks raw keys or fingerprints", () => {
    const rows = [{ apiKey: fingerprintKey(keys[0].key), requests24h: 1, lastUsed: "x" }];
    const json = JSON.stringify(mapUsageToKeys(keys, rows));
    expect(json).not.toContain("sk-");
    expect(json).not.toContain("fp_");
  });
  it("ignores rows for deleted keys and tolerates empty input", () => {
    expect(mapUsageToKeys(keys, [{ apiKey: "fp_0000000000000000", requests24h: 9, lastUsed: "x" }]).k1.requests24h).toBe(0);
    expect(mapUsageToKeys([], null)).toEqual({});
  });
});
