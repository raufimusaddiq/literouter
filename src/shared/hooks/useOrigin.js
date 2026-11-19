"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => window.location.origin;
// Server and the hydration pass render an empty origin so markup matches;
// React then re-renders with the real origin right after hydration.
const getServerSnapshot = () => "";

export function useOrigin() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
