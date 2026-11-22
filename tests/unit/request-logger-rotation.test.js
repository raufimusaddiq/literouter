import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "bun:test";

test("request logs stay within session and size limits", async () => {
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.REQUEST_LOG_MAX_SIZE_MB = "1";
  process.env.REQUEST_LOG_MAX_SESSIONS = "2";
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logs-"));
  process.chdir(tempDir);

  try {
    fs.mkdirSync(path.join(tempDir, "logs", "old-1"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "logs", "old-2"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "logs", "old-1", "large.txt"), "x".repeat(700_000));
    fs.writeFileSync(path.join(tempDir, "logs", "old-2", "large.txt"), "x".repeat(700_000));
    fs.utimesSync(path.join(tempDir, "logs", "old-1"), new Date(0), new Date(0));
    fs.utimesSync(path.join(tempDir, "logs", "old-2"), new Date(1_000), new Date(1_000));

    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js?case=size");
    await createRequestLogger("openai", "openai", "test-model");
    const sessions = fs.readdirSync(path.join(tempDir, "logs"));
    assert.equal(sessions.length, 2);
    assert.equal(sessions.includes("old-1"), false);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session cap is enforced immediately after back-to-back requests", async () => {
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.REQUEST_LOG_MAX_SIZE_MB = "1024";
  process.env.REQUEST_LOG_MAX_SESSIONS = "2";
  process.env.REQUEST_LOG_PRUNE_INTERVAL_MS = "300000";
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logs-fast-"));
  process.chdir(tempDir);

  try {
    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js?case=session");
    for (let i = 0; i < 4; i += 1) {
      const logger = await createRequestLogger("openai", "openai", `model-${i}`);
      fs.writeFileSync(path.join(logger.sessionPath, "big.txt"), "x".repeat(1000));
    }

    assert.equal(fs.readdirSync(path.join(tempDir, "logs")).length, 2);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("chunk appends are async stream writes and land in the session files", async () => {
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.REQUEST_LOG_MAX_SESSIONS = "50";
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logs-async-"));
  process.chdir(tempDir);
  try {
    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js?case=async");
    const logger = await createRequestLogger("openai", "openai", "m");
    for (let i = 0; i < 50; i += 1) {
      logger.appendProviderChunk(`p${i}\n`);
      logger.appendConvertedChunk(`c${i}\n`);
    }
    await logger.flush();
    const p = fs.readFileSync(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8");
    expect(p.split("\n").filter(Boolean)).toHaveLength(50);
    expect(p.startsWith("p0\n")).toBe(true);
    expect(fs.readFileSync(path.join(logger.sessionPath, "7_res_client.txt"), "utf8")).toContain("c49\n");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
