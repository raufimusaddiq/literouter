import { describe, it, expect } from "bun:test";
import { useDep } from "./user.js";

const isolated = !!process.env.BUN_TEST_WORKER_ID;

describe("isolation", () => {
  it.skipIf(!isolated)("dep.js is not mocked in this file", () => {
    expect(useDep()).toBe("real");
  });
});
