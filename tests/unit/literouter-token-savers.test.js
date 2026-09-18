import { describe, expect, it } from "vitest";

// PRD 10: RTK, Caveman, and Ponytail must each work independently.
describe("token savers", () => {
  it("Ponytail injects a system instruction at every level", async () => {
    const { injectPonytail } = await import("open-sse/rtk/ponytail.js");
    for (const level of ["lite", "full", "ultra"]) {
      const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
      injectPonytail(body, "openai", level);
      expect(JSON.stringify(body)).not.toBe(JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    }
  });

  it("Caveman injects at every level", async () => {
    const { injectCaveman } = await import("open-sse/rtk/caveman.js");
    for (const level of ["lite", "full", "ultra"]) {
      const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
      injectCaveman(body, "openai", level);
      expect(JSON.stringify(body)).not.toBe(JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    }
  });

  it("Ponytail and Caveman compose without throwing", async () => {
    const { injectPonytail } = await import("open-sse/rtk/ponytail.js");
    const { injectCaveman } = await import("open-sse/rtk/caveman.js");
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "openai", "full");
    injectPonytail(body, "openai", "full");
    expect(body.messages.length).toBeGreaterThan(0);
  });
});
