import { describe, it, expect, vi, beforeEach } from "vitest";

const bootstrap = vi.fn();
vi.mock("@/shared/services/bootstrap.js", () => { bootstrap(); return {}; });
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock("open-sse/providers/catalogOverride.js", () => ({ installCatalogSource: vi.fn() }));
vi.mock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: vi.fn() }));

describe("instrumentation register()", () => {
  beforeEach(() => { vi.resetModules(); bootstrap.mockClear(); });

  it("starts bootstrap on the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../../src/instrumentation.js");
    await register();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("does not start bootstrap on other runtimes", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("../../src/instrumentation.js");
    await register();
    expect(bootstrap).not.toHaveBeenCalled();
    delete process.env.NEXT_RUNTIME;
  });
});
