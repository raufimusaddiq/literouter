import { describe, it, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lr-spa-dev-"));

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const { isAlive, pruneStaleDevBuilds } = await import("../../src/server/spaBuild.js");

describe("isAlive", () => {
  it("is true for this process", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("is false only when the pid does not exist (ESRCH)", () => {
    const original = process.kill;
    process.kill = () => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    };
    try {
      expect(isAlive(999_999)).toBe(false);
    } finally {
      process.kill = original;
    }
  });

  it("fails closed on EPERM and on unexpected errors", () => {
    const original = process.kill;
    try {
      for (const error of [
        Object.assign(new Error("denied"), { code: "EPERM" }),
        Object.assign(new Error("odd"), { code: "EINVAL" }),
        new Error("no code"),
      ]) {
        process.kill = () => {
          throw error;
        };
        expect(isAlive(4242)).toBe(true);
      }
    } finally {
      process.kill = original;
    }
  });
});

describe("pruneStaleDevBuilds", () => {
  function makeDirs(...names) {
    const dir = fs.mkdtempSync(path.join(root, "dev-"));
    for (const name of names) fs.mkdirSync(path.join(dir, name));
    return dir;
  }

  it("removes dead pid directories and leaves live and non-numeric ones", () => {
    const dir = makeDirs("111", "222", "not-a-pid");
    pruneStaleDevBuilds(dir, { alive: (pid) => pid === 222 });
    expect(fs.readdirSync(dir).sort()).toEqual(["222", "not-a-pid"]);
  });

  it("a removal failure neither throws nor stops the remaining removals", () => {
    const dir = makeDirs("111", "222", "333");
    const removed = [];
    const remove = (target) => {
      if (target.endsWith("111")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      removed.push(path.basename(target));
    };
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => pruneStaleDevBuilds(dir, { alive: () => false, remove })).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(removed.sort()).toEqual(["222", "333"]);
  });

  it("a missing dev root is not an error", () => {
    expect(() => pruneStaleDevBuilds(path.join(root, "absent"))).not.toThrow();
  });
});

describe("startWatchers", () => {
  it("registers the exit cleanup once even when the module is evaluated again", async () => {
    delete globalThis.__lrSpaExitCleanup;
    const before = process.listenerCount("exit");
    const first = await import("../../src/server/spaBuild.js?evaluation=1");
    const second = await import("../../src/server/spaBuild.js?evaluation=2");
    try {
      first.startWatchers();
      second.startWatchers();
      expect(process.listenerCount("exit") - before).toBe(1);
    } finally {
      globalThis.__lrSpaWatchers?.forEach((watcher) => watcher.close());
      globalThis.__lrSpaWatchers = undefined;
    }
  });
});
