import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({
  shouldRefreshCredentials: vi.fn(() => false),
  refreshProviderCredentials: vi.fn(),
}));

const { getProviderConnectionById } = await import("../../src/lib/localDb.js");
const { shouldRefreshCredentials, refreshProviderCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");
const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");

const credentials = {
  connectionId: "connection-1",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  lastRefreshAt: "2026-09-30T00:00:00.000Z",
};

describe("Codex rotated refresh-token snapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("adopts newer persisted tokens before deciding whether to refresh", async () => {
    const latest = {
      accessToken: "new-access",
      refreshToken: "rotated-refresh",
      expiresAt: "2026-10-01T01:00:00.000Z",
      lastRefreshAt: "2026-10-01T00:00:00.000Z",
    };
    getProviderConnectionById.mockResolvedValue(latest);
    const result = await checkAndRefreshToken("codex", credentials);
    expect(result).toMatchObject(latest);
    expect(shouldRefreshCredentials).toHaveBeenCalledWith("codex", expect.objectContaining(latest));
    expect(refreshProviderCredentials).not.toHaveBeenCalled();
  });

  it("does not replace a newer caller snapshot with older DB credentials", async () => {
    getProviderConnectionById.mockResolvedValue({
      accessToken: "older-access",
      refreshToken: "older-refresh",
      lastRefreshAt: "2026-09-29T00:00:00.000Z",
    });
    expect(await checkAndRefreshToken("codex", credentials)).toEqual(credentials);
    expect(refreshProviderCredentials).not.toHaveBeenCalled();
  });
});
