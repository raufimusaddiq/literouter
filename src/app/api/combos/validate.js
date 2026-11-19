import { getCombos } from "@/lib/localDb";

// A combo that (transitively) contains itself expands forever in chat.js, so
// the write paths reject it up front. Depth is capped there too, for combos
// already stored before this check existed.
const MAX_COMBO_DEPTH = 8;

/**
 * Reject a combo whose `models` field is not a string array, or that would
 * close a cycle (a -> a, a -> b -> a) through the combos already stored.
 *
 * @param {{ name: string, models: unknown, id?: string }} candidate
 *   `id` excludes the combo being updated from the graph.
 * @returns {Promise<string|null>} error message, or null when valid.
 */
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

  // Walk down from `name`; reaching it again means the proposal closes a cycle.
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
