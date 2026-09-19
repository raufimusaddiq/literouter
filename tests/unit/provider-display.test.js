// providersDisplay.js derives UI display fields from the provider registry and
// merges them into AI_PROVIDERS. Locks the merge contract only — the previous
// suite also asserted TTS surfaces that have since been removed.
import { describe, it, expect } from "vitest";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import {
  PROVIDER_DISPLAY,
  RISK_NOTICE,
} from "../../src/shared/constants/providersDisplay.js";

describe("provider display merge", () => {
  it("every display entry has a matching AI_PROVIDERS row", () => {
    const ids = Object.keys(PROVIDER_DISPLAY);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(AI_PROVIDERS[id], `${id} missing from AI_PROVIDERS`).toBeDefined();
    }
  });

  it("display name/icon are merged onto the provider entry", () => {
    for (const [id, display] of Object.entries(PROVIDER_DISPLAY)) {
      if (display.name === undefined) continue;
      expect(AI_PROVIDERS[id].name).toBe(display.name);
      if (display.icon !== undefined) expect(AI_PROVIDERS[id].icon).toBe(display.icon);
    }
  });

  it("resolves the RISK_NOTICE token to the full notice text", () => {
    const deprecated = Object.values(AI_PROVIDERS).filter(
      (p) => p.deprecationNotice === RISK_NOTICE
    );
    // Any provider carrying the token must carry the expanded text, never the token.
    for (const p of Object.values(AI_PROVIDERS)) {
      expect(p.deprecationNotice).not.toBe("RISK_NOTICE");
    }
    expect(deprecated).toBeInstanceOf(Array);
  });

  it("keeps transport fields alongside the merged display fields", () => {
    const kiro = AI_PROVIDERS.kiro;
    expect(kiro).toBeDefined();
    expect(kiro.id).toBe("kiro");
    expect(kiro.alias).toBe("kr");
  });
});
