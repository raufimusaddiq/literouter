
import { getPricingForModel } from "./pricing.js";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "./capabilities.js";

const MAX_TRACKED = 500;
const seen = new Set();

function hasCapabilityRow(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  return !Object.keys(DEFAULT_CAPABILITIES).every((k) => caps?.[k] === DEFAULT_CAPABILITIES[k]);
}

export function noteUntrackedModel(provider, model, stage = "cost") {
  try {
    if (!provider || !model) return;
    const key = `${provider}\u0000${model}`;
    if (seen.has(key) || seen.size >= MAX_TRACKED) return;
    const priced = !!getPricingForModel(provider, model);
    const capped = hasCapabilityRow(provider, model);
    if (priced && capped) return;
    seen.add(key);
    const missing = [!priced && "pricing", !capped && "capabilities"].filter(Boolean).join(" + ");
    console.warn(
      `[model-tracking] no ${missing} row for ${provider}/${model} (${stage}); ` +
        "it still routes, but the gap is billed/limited at the default and will be invisible."
    );
  } catch {
  }
}

export function resetUntrackedModelWarnings() {
  seen.clear();
}
