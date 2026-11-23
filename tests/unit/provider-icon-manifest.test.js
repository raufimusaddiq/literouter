import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateProviderIconManifest } from "../../scripts/gen-provider-icon-manifest.mjs";
import { PROVIDER_ICON_IDS } from "../../src/shared/constants/providerIconManifest.js";

const root = resolve(import.meta.dir, "..", "..");

describe("provider icon manifest", () => {
  it("manifest text matches the committed file", () => {
    const committed = readFileSync(resolve(root, "src/shared/constants/providerIconManifest.js"), "utf8");
    expect(generateProviderIconManifest({ root })).toBe(committed.replace(/\r\n/g, "\n"));
  });

  it("ids are sorted and unique", () => {
    const ids = [...PROVIDER_ICON_IDS];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });
});
