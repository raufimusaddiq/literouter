"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => window.location.origin;
const getServerSnapshot = () => "";

export function useOrigin() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
