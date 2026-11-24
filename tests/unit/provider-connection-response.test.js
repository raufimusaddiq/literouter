import { describe, expect, it } from "bun:test";

import { toProviderConnectionResponse } from "../../src/lib/providerConnectionResponse.js";

describe("toProviderConnectionResponse", () => {
  it("drops top-level credentials and the OpenDesign control key", () => {
    const out = toProviderConnectionResponse({
      id: "c1",
      provider: "opendesign-go",
      apiKey: "sk-amr-1",
      accessToken: "a",
      refreshToken: "r",
      idToken: "i",
      providerSpecificData: { opendesignControlKey: "vela_ctrl_x", opendesignWorkspaceId: "ws1" },
    });
    expect(out).toEqual({ id: "c1", provider: "opendesign-go", providerSpecificData: { opendesignWorkspaceId: "ws1" } });
  });

  it("returns providerSpecificData by reference when it holds no secret", () => {
    const psd = { baseUrl: "https://example.test" };
    expect(toProviderConnectionResponse({ id: "c2", providerSpecificData: psd }).providerSpecificData).toBe(psd);
  });
});
