// Monotonic counter bumped by every write that can change routing/auth
// decisions derived from combos, model aliases, or API-key allow lists.
// Caches of such derived data key on it so an edit is visible immediately.
const state = (globalThis.__liteRouterConfigVersion ??= { v: 0 });

export function bumpConfigVersion() { state.v += 1; }
export function getConfigVersion() { return state.v; }
