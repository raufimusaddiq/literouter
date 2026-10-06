import { describe, expect, it } from "vitest";

import { PROVIDERS } from "open-sse/config/providers.js";
import { APIKEY_PROVIDERS, supportsServiceKind } from "@/shared/constants/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

// The dashboard groups providers by capability: chat providers stay in the API Key
// list, System One providers get their own section. Both lists must be disjoint so a
// provider never appears twice.
describe("System One provider catalog", () => {
  const systemOneIds = Object.values(APIKEY_PROVIDERS)
    .filter((provider) => supportsServiceKind(provider, "systemone"))
    .map((provider) => provider.id);

  it("registers exactly the providers whose registry transport is a systemone format", () => {
    const registrySystemOneIds = Object.entries(PROVIDERS)
      .filter(([, transport]) => transport.format === "systemone")
      .map(([id]) => id)
      .sort();

    // cloudflare-ai carries a dedicated systemOneTransport (Clef/Clef-Flash),
    // not a systemone-format primary transport, so it is excluded here.
    expect(systemOneIds.filter((id) => id !== "cloudflare-ai").sort()).toEqual(registrySystemOneIds);
  });

  it("marks System One-only models so they stay out of the chat catalog", () => {
    const clef = getModelsByProviderId("cloudflare-ai").find((m) => m.id === "@cf/cloudflare/clef");
    expect(clef?.kind).toBe("systemone");
    expect(getModelsByProviderId("cloudflare-ai")[0].id).not.toBe("@cf/cloudflare/clef");
  });

  it("keeps System One providers out of the chat provider list", () => {
    const chatIds = Object.values(APIKEY_PROVIDERS)
      .filter((provider) => supportsServiceKind(provider, "llm") && !supportsServiceKind(provider, "systemone"))
      .map((provider) => provider.id);

    for (const id of systemOneIds) expect(chatIds).not.toContain(id);
  });

  it("gives every System One provider at least one selectable model", () => {
    for (const id of systemOneIds) {
      expect(getModelsByProviderId(id).length).toBeGreaterThan(0);
    }
  });
});
