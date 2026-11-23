import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../scripts/build.mjs";

const work = mkdtempSync(join(tmpdir(), "lr-build-failure-"));

afterAll(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("buildApp failure reporting", () => {
  it("surfaces the parser error of a broken entry", async () => {
    const entry = join(work, "broken.js");
    writeFileSync(entry, "export const x = ;\n");
    const stubWeb = async ({ outdir }) => ({ outdir });
    let message = "";
    try {
      await buildApp({ outdir: join(work, "out"), entry, buildWeb: stubWeb });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain("build failed");
    expect(message).toContain("Unexpected");
    expect(message).toContain("broken.js");
  });
});
