import { describe, expect, it } from "bun:test";
import { isTokenSaverEnabled } from "../../open-sse/config/runtimeConfig.js";

describe("token saver bypass headers", () => {
  it.each(["x-9router-token-saver", "x-literouter-token-saver"])("accepts %p", (header) => {
    expect(isTokenSaverEnabled({ [header]: "off" })).toBe(false);
  });
});
