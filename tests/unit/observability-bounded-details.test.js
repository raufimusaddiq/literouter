// T-37: request-detail records are bounded at enqueue time and written once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { vi } from "#test/vi";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bounded-details-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1000 });
});

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const queue = () => globalThis.__liteRouterDetailBuffer.writeBuffer;

describe("bounded request details", () => {
  it("a 5 MB base64 body is a tiny record once enqueued", async () => {
    const b64 = "QUJD".repeat(1_310_720); // 5 MiB
    const body = { model: "m", messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }] }] };
    const url = { model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }] }] };
    const before = queue().length;
    await db.saveRequestDetail({ id: "big-b64", provider: "p", model: "m", status: "success", request: body, providerRequest: url, response: { content: "ok" } });
    expect(queue().length).toBe(before + 1);
    const rec = queue().find((r) => r.id === "big-b64");
    expect(JSON.stringify(rec).length).toBeLessThan(5 * 1024);
    expect(JSON.stringify(rec.request)).toContain(`[image ${b64.length} bytes]`);
    expect(JSON.stringify(rec.providerRequest)).toContain("[image ");
    expect(rec.request._truncated).toBeUndefined();
  });

  it("an oversized non-image field becomes a small truncated stub", async () => {
    await db.saveRequestDetail({ id: "big-text", provider: "p", model: "m", status: "success", request: { prompt: "y ".repeat(2_000_000) } });
    const rec = queue().find((r) => r.id === "big-text");
    expect(rec.request._truncated).toBe(true);
    expect(JSON.stringify(rec).length).toBeLessThan(2 * 1024);
  });

  it("the same id queued twice keeps one entry (single write per request)", async () => {
    await db.saveRequestDetail({ id: "dup-1", provider: "p", model: "m", status: "success", response: { content: "[Streaming in progress...]" } });
    await db.saveRequestDetail({ id: "dup-1", provider: "p", model: "m", status: "success", response: { content: "final" } });
    const rows = queue().filter((r) => r.id === "dup-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].response.content).toBe("final");
    await db.flushRequestDetails();
    const got = await db.getRequestDetailById("dup-1");
    expect(got.response.content).toBe("final");
  });
});
