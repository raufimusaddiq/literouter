import { describe, it, expect, afterEach, spyOn } from "bun:test";
import React from "react";
import { setupDom, mount } from "#test/dom";

setupDom("http://localhost:20128/dashboard/providers");

const originalFetch = globalThis.fetch;

const DETAIL_PAYLOADS = [
  ["/api/providers", { connections: [] }],
  ["/api/provider-nodes", { nodes: [] }],
  ["/api/proxy-pools", { proxyPools: [] }],
  ["/api/models/alias", { aliases: {} }],
  ["/api/models/custom", { models: [] }],
  ["/api/models/disabled", { ids: [] }],
];

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

describe("Providers pages (Route Sheet)", () => {
  it("ProviderDetailPage keeps the title as the only h1 and links the breadcrumb and Back to Providers", async () => {
    window.history.replaceState({}, "", "/dashboard/providers/claude");
    globalThis.fetch = (url) => {
      const u = String(url);
      const payload = DETAIL_PAYLOADS.find(([prefix]) => u.startsWith(prefix))?.[1] ?? {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
    };

    const { ParamsProvider } = await import("../../src/web/router.js");
    const { default: ProviderDetailPage } = await import("../../src/web/pages/dashboard/providers/[id]/page.js");
    const { container, unmount } = await mount(
      React.createElement(
        ParamsProvider,
        { params: { id: "claude" } },
        React.createElement(ProviderDetailPage),
      ),
      { settle: true },
    );

    const crumb = container.querySelector('nav[aria-label="Breadcrumb"]');
    expect(crumb).not.toBeNull();
    expect(crumb.querySelector('a[href="/dashboard/providers"]')?.textContent).toContain("Providers");
    expect(crumb.textContent).toContain("Claude");
    expect(crumb.querySelector("h1")).toBeNull();

    expect(container.querySelector("h1")?.textContent).toContain("Claude");

    const backLink = [...container.querySelectorAll('a[href="/dashboard/providers"]')].find((a) =>
      a.textContent.includes("Back to Providers"),
    );
    expect(backLink).toBeDefined();

    await unmount();
  });

  it.each([
    { remainingMs: 45_000, text: "45s" },
    { remainingMs: 95_000, text: "1m 35s" },
    { remainingMs: 7_380_000, text: "2h 3m" },
    { remainingMs: -1_000, text: null },
  ])("CooldownTimer with $remainingMs ms left renders $text", async ({ remainingMs, text }) => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const nowSpy = spyOn(Date, "now").mockReturnValue(now);
    try {
      const { default: CooldownTimer } = await import("../../src/web/pages/dashboard/providers/[id]/CooldownTimer.js");
      const until = new Date(now + remainingMs).toISOString();
      const { container, unmount } = await mount(React.createElement(CooldownTimer, { until }));

      expect(container.querySelector("span")?.textContent.replace("schedule", "") ?? null).toBe(text);

      await unmount();
    } finally {
      nowSpy.mockRestore();
    }
  });
});
