import { describe, it, expect } from "bun:test";
import alicodeIntl from "../../open-sse/providers/registry/alicode-intl.js";
import alimsIntl from "../../open-sse/providers/registry/alims-intl.js";

describe("alicode-intl endpoint (Coding Plan keys)", () => {
  it("routes to the coding-intl host for Coding Plan keys", () => {
    expect(alicodeIntl.id).toBe("alicode-intl");
    expect(alicodeIntl.transport.baseUrl).toBe(
      "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
    );
  });

  it("keeps the chat/completions path and preserveCacheControl quirk", () => {
    expect(alicodeIntl.transport.baseUrl).toContain("/v1/chat/completions");
    expect(alicodeIntl.transport.quirks.preserveCacheControl).toBe(true);
  });
});

describe("alims-intl endpoint (standard DashScope keys)", () => {
  it("routes to the compatible-mode DashScope endpoint for standard keys", () => {
    expect(alimsIntl.id).toBe("alims-intl");
    expect(alimsIntl.transport.baseUrl).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
  });

  it("does not use the coding-intl host that rejects standard keys", () => {
    expect(alimsIntl.transport.baseUrl).not.toContain("coding-intl.dashscope.aliyuncs.com");
  });
});
