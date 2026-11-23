"use client";

import { useCallback, useEffect, useRef } from "react";

const escapeLayers = [];
let listening = false;
let scrollLockCount = 0;
let savedBodyOverflow = "";

function onGlobalKeyDown(event) {
  if (event.key !== "Escape" || escapeLayers.length === 0) return;
  const top = escapeLayers[escapeLayers.length - 1];
  top.onEscapeRef.current?.(event);
}

function syncListener() {
  if (typeof document === "undefined") return;
  if (escapeLayers.length > 0 && !listening) {
    document.addEventListener("keydown", onGlobalKeyDown);
    listening = true;
  } else if (escapeLayers.length === 0 && listening) {
    document.removeEventListener("keydown", onGlobalKeyDown);
    listening = false;
  }
}

export function isTopEscapeLayer(layer) {
  return escapeLayers.length > 0 && escapeLayers[escapeLayers.length - 1] === layer;
}

export function useEscapeLayer(active, onEscape) {
  const onEscapeRef = useRef(onEscape);
  const layerRef = useRef(null);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return undefined;
    if (layerRef.current == null) {
      layerRef.current = { onEscapeRef };
    }
    const entry = layerRef.current;
    const existing = escapeLayers.indexOf(entry);
    if (existing !== -1) escapeLayers.splice(existing, 1);
    escapeLayers.push(entry);
    syncListener();
    return () => {
      const idx = escapeLayers.indexOf(entry);
      if (idx !== -1) escapeLayers.splice(idx, 1);
      syncListener();
    };
  }, [active]);

  return useCallback(() => isTopEscapeLayer(layerRef.current), []);
}

export function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [active]);
}
