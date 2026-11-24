import { describe, it, expect } from "bun:test";
import { headExtras } from "../../src/web/head.js";

describe("headExtras", () => {
  it("emits icon and manifest links and no analytics without a gaId", () => {
    const html = headExtras({ gaId: null });
    expect(html).toContain('<link rel="icon" href="/favicon.svg?v=3" type="image/svg+xml">');
    expect(html).toContain('<link rel="icon" href="/icons/favicon-32.png?v=3" type="image/png" sizes="32x32">');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).not.toContain("googletagmanager");
  });

  it("gives home-screen installs a PNG touch icon and a title", () => {
    const html = headExtras({ gaId: null });
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="LiteRouter">');
  });

  it("points link previews at an absolute og.png for a valid origin", () => {
    const html = headExtras({ origin: "https://ai.example.com" });
    expect(html).toContain('<meta property="og:image" content="https://ai.example.com/og.png">');
    expect(html).toContain('<meta name="twitter:image" content="https://ai.example.com/og.png">');
    expect(html).toContain('<meta property="og:url" content="https://ai.example.com/">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it.each([
    ['https://x"><script>alert(1)</script>'],
    ["javascript:alert(1)"],
    ["https://ai.example.com/path"],
    [""],
    [undefined],
  ])("falls back to a relative og.png for origin %p", (origin) => {
    const html = headExtras({ origin });
    expect(html).toContain('<meta property="og:image" content="/og.png">');
    expect(html).not.toContain("og:url");
    expect(html).not.toContain("alert(1)");
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
      expect(html).toContain("/favicon.svg?v=3");
    }
  });
});
