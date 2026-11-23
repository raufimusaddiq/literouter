import zlib from "node:zlib";

export const ACCEPT_ENCODING = typeof zlib.createZstdDecompress === "function"
  ? "gzip, deflate, br, zstd"
  : "gzip, deflate, br";
