import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../open-sse/utils/stream.js", import.meta.url), "utf8");

// PRD 20: streaming event semantics must stay valid. Emitting the OpenAI
// sentinel twice is invalid for strict SSE clients, so every site that writes
// it must also mark it sent.
describe("stream [DONE] sentinel", () => {
  it("marks the sentinel as sent wherever it is written", () => {
    const lines = source.split("\n");
    const writeSites = [];

    lines.forEach((line, index) => {
      if (line.includes('const doneOutput = "data: [DONE]\\n\\n"')) writeSites.push(index);
    });

    expect(writeSites.length).toBeGreaterThan(0);

    for (const index of writeSites) {
      // Look at the next few lines for the enqueue plus a guard update.
      const window = lines.slice(index, index + 6).join("\n");
      expect(window, `site at line ${index + 1} must set streamDoneSent`).toContain("streamDoneSent = true");
    }
  });

  it("guards the passthrough termination on streamDoneSent", () => {
    expect(source).toContain("if (!streamDoneSent && !isGeminiFamily)");
  });
});
