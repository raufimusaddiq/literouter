/**
 * Visibility for models that route but have no static pricing/capability row.
 *
 * Live catalogs (Claude OAuth /models, CommandCode's public catalog, passthrough
 * providers) can surface an id LiteRouter has never catalogued. Those ids must
 * keep routing — the request succeeds — but a silent $0 bill and the default
 * 200k/64k capability floor hide a real gap. Log exactly one line per id so the
 * gap is discoverable, bounded, and never includes credentials.
 */

import { getPricingForModel } from "./pricing.js";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "./capabilities.js";

// Bounded: a hostile/renamed catalog cannot grow this set without limit.
const MAX_TRACKED = 500;
const seen = new Set();

function hasCapabilityRow(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  // Same shape as the floor means no row matched anywhere in the chain.
  return !Object.keys(DEFAULT_CAPABILITIES).every((k) => caps?.[k] === DEFAULT_CAPABILITIES[k]);
}

/**
 * Log once when `model` on `provider` is missing static pricing or capability
 * rows. `stage` names the call site so the line is actionable. Never throws,
 * never logs the credential or the request body.
 */
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
    // Diagnostics must never break a request.
  }
}

export function resetUntrackedModelWarnings() {
  seen.clear();
}
