import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { vi } from "#test/vi";

export function useTempDataDir(prefix, { scope = "each" } = {}) {
  const [setup, teardown] = scope === "all" ? [beforeAll, afterAll] : [beforeEach, afterEach];
  const state = { dir: null, original: undefined };

  setup(() => {
    state.original = process.env.DATA_DIR;
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.DATA_DIR = state.dir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  teardown(async () => {
    try {
      await global._dbAdapter?.instance?.close?.();
    } finally {
      delete global._dbAdapter;
      if (state.original === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = state.original;
      fs.rmSync(state.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  return {
    get dir() {
      return state.dir;
    },
  };
}

export function useTempDataDirAtLoad(prefix) {
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;

  afterAll(async () => {
    try {
      await global._dbAdapter?.instance?.close?.();
    } finally {
      delete global._dbAdapter;
      if (original === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = original;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  return dir;
}
