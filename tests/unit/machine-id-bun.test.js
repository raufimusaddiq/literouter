import { describe, it, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "machine-id-bun-"));
fs.mkdirSync(path.join(dataDir, "auth"));
fs.writeFileSync(path.join(dataDir, "machine-id"), "seed-machine-id-0001\n");
fs.writeFileSync(path.join(dataDir, "auth", "cli-secret"), "seed-cli-secret-0001\n");
const originalDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("node-machine-id under Bun", () => {
  it("machineIdSync works under Bun and is stable", () => {
    const first = machineIdSync();
    const second = machineIdSync();
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("getConsistentMachineId('9r-cli-auth') from seeded machine-id and cli-secret files equals the sha256 formula", async () => {
    const { getConsistentMachineId } = await import("../../src/shared/utils/machineId.js");
    const literal = "04047ddeb7c221a4";
    expect(await getConsistentMachineId("9r-cli-auth")).toBe(literal);
    const formula = crypto
      .createHash("sha256")
      .update("seed-machine-id-0001" + "9r-cli-auth" + "seed-cli-secret-0001")
      .digest("hex")
      .substring(0, 16);
    expect(formula).toBe(literal);
  });

  it("open-sse/shared/machineId derives from machineIdSync", async () => {
    const { getConsistentMachineId } = await import("../../open-sse/shared/machineId.js");
    const raw = machineIdSync();
    const expected = crypto.createHash("sha256").update(raw + "endpoint-proxy-salt").digest("hex").substring(0, 16);
    expect(await getConsistentMachineId()).toBe(expected);
    const custom = crypto.createHash("sha256").update(raw + "other-salt").digest("hex").substring(0, 16);
    expect(await getConsistentMachineId("other-salt")).toBe(custom);
  });
});
