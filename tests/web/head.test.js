import { describe, it, expect } from "bun:test";
import { headExtras } from "../../src/web/head.js";

describe("headExtras", () => {
  it("emits icon and manifest links and no analytics without a gaId", () => {
    const html = headExtras({ gaId: null });
    expect(html).toContain('<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">');
    expect(html).toContain('<link rel="shortcut icon" href="/favicon.svg?v=2">');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).not.toContain("googletagmanager");
  });

  it("adds the gtag snippet for a valid gaId", () => {
    const html = headExtras({ gaId: "G-ABC123" });
    expect(html).toContain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>');
    expect(html).toContain("gtag('config', 'G-ABC123')");
    expect(html).toContain("gtag('js', new Date())");
    expect(html).toContain("dataLayer");
  });

  it("never interpolates an invalid gaId", () => {
    for (const gaId of ['x"></script><script>alert(1)</script>', "", "a".repeat(33), "G ABC", undefined, 5]) {
      const html = headExtras({ gaId });
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("googletagmanager");
      expect(html).toContain("/favicon.svg?v=2");
    }
  });
});
