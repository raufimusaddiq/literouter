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
  it("ProviderDetailPage keeps the title as the only h1 and links the breadcrumb and Back to Providers", async () => {
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

  it("CooldownTimer renders the remaining countdown", async () => {
    const { default: CooldownTimer } = await import("../../src/web/pages/dashboard/providers/[id]/CooldownTimer.js");
    const future = new Date(Date.now() + 95_000).toISOString();
    const { container, unmount } = await mount(React.createElement(CooldownTimer, { until: future }));

    const el = container.querySelector("span");
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/1m \d+s/);

    await unmount();
  });
});
