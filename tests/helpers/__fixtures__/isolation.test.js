import { describe, it, expect } from "bun:test";
import { useDep } from "./user.js";

// Another file (vi.test.js / nested/relative-mock.test.js) mocks dep.js.
// Under `bun test --parallel` (per-file isolation) that mock must not leak here.
// Plain `bun test` shares one module registry, so the assertion only applies in parallel workers.
const isolated = !!process.env.BUN_TEST_WORKER_ID;

describe("isolation", () => {
  it.skipIf(!isolated)("dep.js is not mocked in this file", () => {
    expect(useDep()).toBe("real");
  });
});
