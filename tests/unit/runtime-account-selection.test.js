import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials, resetProviderSelectionState } = await import("@/sse/services/auth.js");

function accounts(provider) {
  return [
    { id: `${provider}-1`, provider, name: `${provider} one`, priority: 1, isActive: true },
    { id: `${provider}-2`, provider, name: `${provider} two`, priority: 2, isActive: true },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderSelectionState();
  mocks.getSettings.mockResolvedValue({
    fallbackStrategy: "round-robin",
    stickyRoundRobinLimit: 1,
    providerStrategies: {},
  });
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
});

describe("runtime account selection", () => {
  it("does not serialize unrelated providers behind one global mutex", async () => {
    let releaseSlow;
    mocks.getProviderConnections.mockImplementation(({ provider }) => {
      if (provider === "slow") {
        return new Promise((resolve) => {
          releaseSlow = () => resolve(accounts("slow"));
        });
      }
      return Promise.resolve(accounts(provider));
    });

    const slow = getProviderCredentials("slow");
    const fast = getProviderCredentials("fast");

    const winner = await Promise.race([
      fast.then(() => "fast"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(winner).toBe("fast");
    releaseSlow();
    await slow;
  });

  it("rotates in memory without durable writes", async () => {
    mocks.getProviderConnections.mockImplementation(({ provider }) => Promise.resolve(accounts(provider)));

    const selected = await Promise.all(
      Array.from({ length: 20 }, () => getProviderCredentials("codex"))
    );

    expect(selected.map((item) => item.connectionId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? "codex-1" : "codex-2")
    );
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps round-robin state independent per provider", async () => {
    mocks.getProviderConnections.mockImplementation(({ provider }) => Promise.resolve(accounts(provider)));

    const [a1, b1, a2, b2] = await Promise.all([
      getProviderCredentials("alpha"),
      getProviderCredentials("beta"),
      getProviderCredentials("alpha"),
      getProviderCredentials("beta"),
    ]);

    expect([a1.connectionId, a2.connectionId]).toEqual(["alpha-1", "alpha-2"]);
    expect([b1.connectionId, b2.connectionId]).toEqual(["beta-1", "beta-2"]);
  });
});
