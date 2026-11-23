import tls from "node:tls";

export function useSystemCaStore(tlsApi = tls, fetchHost = globalThis) {
  if (typeof tlsApi.setDefaultCACertificates !== "function" || typeof tlsApi.getCACertificates !== "function") {
    throw new Error("CA trust: tls.setDefaultCACertificates is unavailable (Bun or Node with system CA support required)");
  }
  const system = tlsApi.getCACertificates("system");
  if (!Array.isArray(system) || system.length === 0) {
    throw new Error("CA trust: system CA store is empty or unreadable; refusing to fall back to the bundled roots");
  }
  tlsApi.setDefaultCACertificates(system);
  return system.length;
}
