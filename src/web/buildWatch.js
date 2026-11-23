import { BUILD_HEADER } from "@/shared/utils/buildEntry";

const listeners = new Set();
let available = false;
let active = null;

export function subscribeUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdateAvailable() {
  return available;
}

function setAvailable(value) {
  if (available === value) return;
  available = value;
  for (const listener of listeners) listener();
}

function readOwnEntry() {
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]');
  return script?.getAttribute("src") ?? null;
}

function isApiResponse(res) {
  try {
    const url = new URL(res.url, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function inspect(res, ownEntry) {
  try {
    if (!isApiResponse(res)) return;
    const served = res.headers.get(BUILD_HEADER);
    if (served && served !== ownEntry) setAvailable(true);
  } catch {
    return;
  }
}

export function watchBuild() {
  if (active) return active;
  const ownEntry = readOwnEntry();
  if (!ownEntry) return () => {};
  const original = window.fetch;
  const wrapped = (...args) =>
    original.apply(window, args).then((res) => {
      inspect(res, ownEntry);
      return res;
    });
  window.fetch = wrapped;
  active = () => {
    if (window.fetch === wrapped) window.fetch = original;
    active = null;
    setAvailable(false);
  };
  return active;
}
