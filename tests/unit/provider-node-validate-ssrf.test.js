import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookupMock, fetchMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), fetchMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");

function request(baseUrl) {
  return new Request("http://localhost/api/provider-nodes/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: "k", type: "openai-compatible" }),
  });
}

describe("POST /api/provider-nodes/validate SSRF guard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });

  it("does not fetch a private provider node", async () => {
    const res = await POST(request("http://169.254.169.254/latest/meta-data"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
