"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query, serverFallback = false) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mql = window.matchMedia(query);
      if (typeof mql?.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      if (typeof mql?.addListener === "function") {
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
      }
      return () => {};
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return serverFallback;
    }
    return Boolean(window.matchMedia(query)?.matches);
  }, [query, serverFallback]);

  return useSyncExternalStore(subscribe, getSnapshot, () => serverFallback);
}
