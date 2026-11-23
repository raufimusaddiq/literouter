import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../open-sse/utils/stream.js", import.meta.url), "utf8");

describe("stream [DONE] sentinel", () => {
  it("marks the sentinel as sent wherever it is written", () => {
    const lines = source.split("\n");
    const writeSites = [];

    lines.forEach((line, index) => {
      if (line.includes('const doneOutput = "data: [DONE]\\n\\n"')) writeSites.push(index);
    });

    expect(writeSites.length).toBeGreaterThan(0);

    for (const index of writeSites) {
      const window = lines.slice(index, index + 6).join("\n");
      expect(window, `site at line ${index + 1} must set streamDoneSent`).toContain("streamDoneSent = true");
    }
  });

  it("guards the passthrough termination on streamDoneSent", () => {
    expect(source).toContain("if (!streamDoneSent && !suppressDone)");
  });
});
