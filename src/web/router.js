import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from "react";

const listeners = new Set();
const EMPTY_PARAMS = Object.freeze({});
const ParamsContext = createContext(EMPTY_PARAMS);

function notify() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function getSnapshot() {
  return window.location.pathname + window.location.search;
}

function getServerSnapshot() {
  return "/";
}

function normalize(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function matchRoute(pattern, pathname) {
  const patternParts = normalize(pattern).split("/");
  const pathParts = normalize(pathname).split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(":")) {
      if (!actual) return null;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function resolveHref(href, base) {
  if (typeof href !== "string" || href.startsWith("//")) return null;
  try {
    const baseUrl = new URL(base);
    const url = new URL(href, baseUrl);
    if (url.origin !== baseUrl.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

function assignExternal(href) {
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") window.location.assign(url.href);
  } catch {
    return;
  }
}

export function navigate(href, mode = "push") {
  const target = resolveHref(String(href), window.location.href);
  if (target === null) {
    assignExternal(String(href));
    return;
  }
  if (mode === "replace") window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  notify();
}

export function redirect(href) {
  navigate(href, "replace");
}

const router = Object.freeze({
  push: (href) => navigate(href, "push"),
  replace: (href) => navigate(href, "replace"),
  back: () => window.history.back(),
  refresh: () => notify(),
});

export function useRouter() {
  return router;
}

function useLocationSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function usePathname() {
  const snapshot = useLocationSnapshot();
  const queryStart = snapshot.indexOf("?");
  return queryStart === -1 ? snapshot : snapshot.slice(0, queryStart);
}

export function useSearchParams() {
  const snapshot = useLocationSnapshot();
  const queryStart = snapshot.indexOf("?");
  const search = queryStart === -1 ? "" : snapshot.slice(queryStart);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams() {
  return useContext(ParamsContext);
}

export function ParamsProvider({ params, children }) {
  return createElement(ParamsContext.Provider, { value: params ?? EMPTY_PARAMS }, children);
}

export function Link({ href, onClick, target, ...rest }) {
  const handleClick = (event) => {
    if (onClick) onClick(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;
    const resolved = resolveHref(String(href), window.location.href);
    if (resolved === null) return;
    event.preventDefault();
    navigate(resolved, "push");
  };
  return createElement("a", { ...rest, href, target, onClick: handleClick });
}
