export function matchesOAuthState(expectedState, state) {
  return typeof expectedState === "string" && expectedState.length > 0 && state === expectedState;
}
