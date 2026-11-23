import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

const here = dirname(fileURLToPath(import.meta.url));
const allow = JSON.parse(readFileSync(join(here, "fixtures/pricing-coverage-allow.json"), "utf8"));
const aliasToId = Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, a]) => [a, id]));

function chatModels() {
  const out = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    const pid = aliasToId[alias] || alias;
    for (const m of models || []) {
      const id = m.id || m;
      if (m.type && m.type !== "llm" && m.type !== "chat") continue;
      out.push({ pid, alias, id });
    }
  }
  return out;
}

describe("pricing coverage", () => {
  it("every chat/llm catalog model has a pricing row or an allowlist entry with a reason", () => {
    const allowed = new Set(allow.map((e) => `${e.provider}\t${e.model}`));
    const gaps = chatModels()
      .filter(({ pid, alias, id }) => !(getPricingForModel(pid, id) || getPricingForModel(alias, id)))
      .filter(({ pid, id }) => !allowed.has(`${pid}\t${id}`))
      .map(({ pid, id }) => `${pid}/${id}`);
    expect(gaps, `Unpriced models (add a pricing.js row, or an allowlist entry with a reason):\n${gaps.join("\n")}`).toEqual([]);
  });

  it("allowlist entries carry a reason and still point at an unpriced catalog model", () => {
    const unpriced = new Set(
      chatModels()
        .filter(({ pid, alias, id }) => !(getPricingForModel(pid, id) || getPricingForModel(alias, id)))
        .map(({ pid, id }) => `${pid}\t${id}`),
    );
    for (const e of allow) {
      expect(typeof e.reason === "string" && e.reason.trim().length > 0, `${e.provider}/${e.model} needs a reason`).toBe(true);
      expect(unpriced.has(`${e.provider}\t${e.model}`), `stale allowlist entry ${e.provider}/${e.model} (now priced or removed)`).toBe(true);
    }
  });
});
