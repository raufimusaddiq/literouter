import tls from "node:tls";

const WRAPPED = Symbol.for("literouter.systemCaFetch");
const SYSTEM_CA = Symbol.for("literouter.systemCaList");

function hasCallerCa(init) {
  const ca = init?.tls?.ca;
  return Array.isArray(ca) ? ca.length > 0 : Boolean(ca);
}

function wrapFetch(original, system) {
  const wrapped = function fetch(input, init) {
    if (hasCallerCa(init)) return original.call(this, input, init);
    return original.call(this, input, { ...init, tls: { ...init?.tls, ca: system } });
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
    if (fetchHost === globalThis) globalThis[SYSTEM_CA] = system;
    fetchHost.fetch = wrapFetch(fetchHost.fetch[WRAPPED] ?? fetchHost.fetch, system);
  }
  return system.length;
}
