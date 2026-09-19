// GET /api/oauth/cursor/auto-import — locates Cursor's state.vscdb per
// platform, reads cursorAuth/accessToken + storage.serviceMachineId via
// better-sqlite3, and falls back to the sqlite3 CLI when native bindings
// are unavailable. Mirrors the route in
// src/app/api/oauth/cursor/auto-import/route.js.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

import * as fsPromises from "fs/promises";

const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) throw new Error("SQLITE_CANTOPEN");
      return mockDbInstance;
    }
  },
}));

let GET;

// The route reads keys one at a time via prepare(...).get().
function mockRows(rows) {
  mockDbInstance.prepare.mockImplementation(() => ({
    get: (key) => rows.find((r) => r.key === key),
  }));
}

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    ({ GET } = await import("../../src/app/api/oauth/cursor/auto-import/route.js"));
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  it("reports not-found when no candidate db path exists", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
  });

  it("extracts the access token and machine id from the exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockRows([
      { key: "cursorAuth/accessToken", value: "test-token" },
      { key: "storage.serviceMachineId", value: "test-machine-id" },
    ]);

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("unwraps JSON-encoded token values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockRows([
      { key: "cursorAuth/accessToken", value: '"json-token"' },
      { key: "storage.serviceMachineId", value: '"json-machine-id"' },
    ]);

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls back to manual import when the db cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    // better-sqlite3 failed and the sqlite3 CLI is absent in the test env,
    // so the route asks the caller to paste the tokens by hand.
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toContain("state.vscdb");
  });
});
