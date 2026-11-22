// Note: an explicit 0 row counts as covered (cost not tracked); the CI guard only catches
// null/missing pricing, so the explicit-zero count is printed here to keep those visible.
// Read-only report: which chat/llm catalog models have no pricing row (or an explicit 0/0 row).
// Usage: bun tests/__baseline__/report-pricing-coverage.mjs [provider-substring] [all]
// The filter is a plain case-insensitive substring of the provider id (not a regex).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } = await import(join(root, "open-sse/config/providerModels.js"));
const { getPricingForModel } = await import(join(root, "open-sse/providers/pricing.js"));

const aliasToId = Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, a]) => [a, id]));
const filter = (process.argv[2] || "").toLowerCase();
const showAll = process.argv[3] === "all";

const rows = [];
for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
  const pid = aliasToId[alias] || alias;
  if (!pid.toLowerCase().includes(filter)) continue;
  for (const m of models || []) {
    const id = m.id || m;
    if (m.type && m.type !== "llm" && m.type !== "chat") continue;
    const p = getPricingForModel(pid, id) || getPricingForModel(alias, id);
    rows.push({ pid, id, price: p ? `${p.input}/${p.output}` : "MISSING" });
  }
}
const missing = rows.filter((r) => r.price === "MISSING");
const zero = rows.filter((r) => r.price === "0/0");
console.log(JSON.stringify({ total: rows.length, missingPrice: missing.length, zeroPrice: zero.length, explicitZeroRows: zero.length }));
for (const r of showAll ? rows : [...missing, ...zero]) console.log(`${r.pid}\t${r.id}\t${r.price}`);
