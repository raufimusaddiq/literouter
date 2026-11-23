import tls from "node:tls";

const WRAPPED = Symbol.for("literouter.systemCaFetch");

function wrapFetch(original, system) {
  const wrapped = function fetch(input, init) {
    if (init?.tls?.ca) return original.call(this, input, init);
    return original.call(this, input, { ...init, tls: { ca: system, ...init?.tls } });
  };
  if (typeof original.preconnect === "function") wrapped.preconnect = original.preconnect.bind(original);
  wrapped[WRAPPED] = original;
  return wrapped;
}

export function useSystemCaStore(tlsApi = tls, fetchHost = globalThis) {
  if (typeof tlsApi.setDefaultCACertificates !== "function" || typeof tlsApi.getCACertificates !== "function") {
    throw new Error("CA trust: tls.setDefaultCACertificates is unavailable (Bun or Node with system CA support required)");
  }
  const system = tlsApi.getCACertificates("system");
  if (!Array.isArray(system) || system.length === 0) {
    throw new Error("CA trust: system CA store is empty or unreadable; refusing to fall back to the bundled roots");
  }
  tlsApi.setDefaultCACertificates(system);
  if (typeof fetchHost?.fetch === "function") {
    fetchHost.fetch = wrapFetch(fetchHost.fetch[WRAPPED] ?? fetchHost.fetch, system);
  }
  return system.length;
}
