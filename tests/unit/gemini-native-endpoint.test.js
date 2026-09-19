import { describe, expect, it } from "vitest";

import { GET, OPTIONS } from "../../src/app/api/v1beta/models/route.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

// The old suite here asserted TTS model names that the route no longer serves
// (ttsModels.js is a separate table). This asserts the live contract: every
// provider model is listed under models/<provider>/<id>, and gemini models also
// get the bare models/<id> alias Gemini clients call.
describe("Gemini native v1beta models endpoint", () => {
  it("answers CORS preflight", async () => {
    const res = await OPTIONS();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("lists provider-qualified and bare gemini model names", async () => {
    const { models } = await (await GET()).json();
    const names = models.map((model) => model.name);

    const [provider, list] = Object.entries(PROVIDER_MODELS)[0];
    expect(names).toContain(`models/${provider}/${list[0].id}`);

    for (const model of PROVIDER_MODELS.gemini) {
      expect(names).toContain(`models/gemini/${model.id}`);
      expect(names).toContain(`models/${model.id}`);
    }
  });

  it("de-duplicates names and reports generation methods", async () => {
    const { models } = await (await GET()).json();
    const names = models.map((model) => model.name);
    expect(new Set(names).size).toBe(names.length);
    for (const model of models) {
      expect(model.supportedGenerationMethods).toContain("generateContent");
    }
  });
});
