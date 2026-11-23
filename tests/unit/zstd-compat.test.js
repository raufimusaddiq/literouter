import { describe, expect, it } from "bun:test";
import zlib from "node:zlib";
import { ACCEPT_ENCODING } from "../../open-sse/utils/zstdCompat.js";

describe("zstdCompat", () => {
  it("advertises zstd only when the runtime can decode it", () => {
    const canDecode = typeof zlib.createZstdDecompress === "function";
    expect(ACCEPT_ENCODING).toBe(canDecode ? "gzip, deflate, br, zstd" : "gzip, deflate, br");
  });
});
