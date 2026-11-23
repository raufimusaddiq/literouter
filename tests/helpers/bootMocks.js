import { vi } from "#test/vi";

export function mockBootCollaborators() {
  const calls = {
    warn: vi.fn(),
    consoleCapture: vi.fn(),
    catalog: vi.fn(),
    modelSync: vi.fn(),
    kenariSync: vi.fn(),
    bootstrap: vi.fn(),
    outboundProxy: vi.fn(),
  };
  vi.mock("@/lib/auth/apiKeySecretWarning", () => ({ warnIfWeakApiKeySecret: (...a) => calls.warn(...a) }));
  vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: (...a) => calls.consoleCapture(...a) }));
  vi.mock("open-sse/providers/catalogOverride.js", () => ({ installCatalogSource: (...a) => calls.catalog(...a) }));
  vi.mock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: (...a) => calls.modelSync(...a) }));
  vi.mock("@/lib/modelCatalog/kenariSync.js", () => ({ startKenariCatalogSync: (...a) => calls.kenariSync(...a) }));
  vi.mock("@/shared/services/bootstrap.js", () => {
    calls.bootstrap();
    return {};
  });
  vi.mock("@/lib/network/initOutboundProxy", () => {
    calls.outboundProxy();
    return { default: () => {}, ensureOutboundProxyInitialized: () => {} };
  });
  return calls;
}
