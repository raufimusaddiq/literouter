const state = (globalThis.__liteRouterConfigVersion ??= { v: 0 });

export function bumpConfigVersion() { state.v += 1; }
export function getConfigVersion() { return state.v; }
