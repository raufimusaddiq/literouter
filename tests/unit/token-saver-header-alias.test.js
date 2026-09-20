import { describe, expect, it } from "vitest";
import { isTokenSaverEnabled } from "../../open-sse/config/runtimeConfig.js";

describe("token saver bypass headers", () => {
  it.each(["x-9router-token-saver", "x-literouter-token-saver"])("accepts %s", (header) => {
    expect(isTokenSaverEnabled({ [header]: "off" })).toBe(false);
  });
});
