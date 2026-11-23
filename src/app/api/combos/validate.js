import { getCombos } from "@/lib/localDb";
import { MAX_COMBO_DEPTH } from "open-sse/config/runtimeConfig.js";


export async function validateCombo({ name, models, id = null }) {
  if (!Array.isArray(models) || models.some((m) => typeof m !== "string")) {
    return "Models must be an array of strings";
  }

  const edges = new Map();
  for (const combo of await getCombos()) {
    if (combo.id === id) continue;
    edges.set(combo.name, combo.models || []);
  }
  edges.set(name, models);

  const seen = new Set();
  const stack = [{ name, depth: 1 }];
  while (stack.length) {
    const { name: current, depth } = stack.pop();
    if (depth > MAX_COMBO_DEPTH) {
      return `Combo nesting deeper than ${MAX_COMBO_DEPTH} levels`;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    for (const member of edges.get(current) || []) {
      if (member === name) {
        return current === name
          ? `Combo "${name}" cannot reference itself`
          : `Combo "${name}" would reference itself through "${current}"`;
      }
      if (edges.has(member)) stack.push({ name: member, depth: depth + 1 });
    }
  }

  return null;
}
