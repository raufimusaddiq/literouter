import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost:20128/dashboard/providers" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const originalFetch = globalThis.fetch;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await flush();
  return {
    container,
    unmount: () =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard/providers");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

describe("Providers pages (Route Sheet)", () => {
  it("ProvidersPage keeps section-header action buttons nowrap inside wrapping header rows", async () => {
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.startsWith("/api/providers")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            connections: [
              { id: "c1", provider: "claude", authType: "oauth", name: "Primary", testStatus: "active", isActive: true },
            ],
          }),
        });
      }
      if (u.startsWith("/api/provider-nodes")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nodes: [] }) });
      }
      if (u.startsWith("/api/models/availability")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ models: [], unavailableCount: 0 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };

    const { default: ProvidersPage } = await import("../../src/web/pages/dashboard/providers/page.js");
    const { container, unmount } = await mount(React.createElement(ProvidersPage));

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Providers");
    expect(container.querySelector("#needs-attention")).not.toBeNull();

    const buttons = [...container.querySelectorAll("button")];
    const addAnthropic = buttons.find((b) => b.textContent.includes("Add Anthropic Compatible"));
    const addOpenAI = buttons.find((b) => b.textContent.includes("Add OpenAI Compatible"));
    expect(addAnthropic).toBeDefined();
    expect(addOpenAI).toBeDefined();
    expect(addAnthropic.className).toContain("whitespace-nowrap");
    expect(addOpenAI.className).toContain("whitespace-nowrap");
    expect(addAnthropic.closest("[data-section-header]")?.className).toContain("flex-wrap");

    await unmount();
  });

  it("ProviderDetailPage renders PageHeader breadcrumb, single h1, and Back to Providers link", async () => {
    window.history.replaceState({}, "", "/dashboard/providers/claude");
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.startsWith("/api/providers")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ connections: [] }) });
      }
      if (u.startsWith("/api/provider-nodes")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nodes: [] }) });
      }
      if (u.startsWith("/api/proxy-pools")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ proxyPools: [] }) });
      }
      if (u.startsWith("/api/models/alias")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ aliases: {} }) });
      }
      if (u.startsWith("/api/models/custom")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ models: [] }) });
      }
      if (u.startsWith("/api/models/disabled")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ids: [] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };

    const { ParamsProvider } = await import("../../src/web/router.js");
    const { default: ProviderDetailPage } = await import("../../src/web/pages/dashboard/providers/[id]/page.js");
    const { container, unmount } = await mount(
      React.createElement(
        ParamsProvider,
        { params: { id: "claude" } },
        React.createElement(ProviderDetailPage),
      ),
    );

    const crumb = container.querySelector('nav[aria-label="Breadcrumb"]');
    expect(crumb).not.toBeNull();
    expect(crumb.textContent).toContain("Providers");
    expect(crumb.textContent).toContain("Claude");
    expect(crumb.querySelector("h1")).toBeNull();

    const h1s = container.querySelectorAll("h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toContain("Claude");

    const backLink = [...container.querySelectorAll('a[href="/dashboard/providers"]')].find((a) =>
      a.textContent.includes("Back to Providers"),
    );
    expect(backLink).toBeDefined();

    await unmount();
  });

  it("CooldownTimer renders countdown figures in monospace", async () => {
    const { default: CooldownTimer } = await import("../../src/web/pages/dashboard/providers/[id]/CooldownTimer.js");
    const future = new Date(Date.now() + 95_000).toISOString();
    const { container, unmount } = await mount(React.createElement(CooldownTimer, { until: future }));

    const el = container.querySelector("span");
    expect(el).not.toBeNull();
    expect(el.className).toContain("font-mono");
    expect(el.className).toContain("tabular-nums");
    expect(el.textContent).toMatch(/1m \d+s/);

    await unmount();
  });
});
