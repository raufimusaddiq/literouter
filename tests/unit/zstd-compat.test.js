import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { ACCEPT_ENCODING } from "../../open-sse/utils/zstdCompat.js";

describe("zstdCompat", () => {
  it("advertises zstd only when the runtime can decode it", () => {
    const canDecode = typeof zlib.createZstdDecompress === "function";
    expect(ACCEPT_ENCODING).toBe(canDecode ? "gzip, deflate, br, zstd" : "gzip, deflate, br");
  });

  it("always advertises the codings every supported Node can inflate", () => {
    expect(ACCEPT_ENCODING).toContain("gzip");
    expect(ACCEPT_ENCODING).toContain("deflate");
    expect(ACCEPT_ENCODING).toContain("br");
  });
});
