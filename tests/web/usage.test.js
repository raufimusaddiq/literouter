import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "#test/vi";

vi.mock("../../src/web/pages/dashboard/usage/components/ProviderTopology.js", () => ({
  default: () => React.createElement("div", { "data-topology-stub": "true" }),
}));

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost:20128/dashboard/usage" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = typeof window !== "undefined" ? window.matchMedia : undefined;

class MockEventSource {
  close() {}
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
  globalThis.EventSource = MockEventSource;
  window.EventSource = MockEventSource;
  globalThis.ResizeObserver = MockResizeObserver;
  window.ResizeObserver = MockResizeObserver;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  window.history.replaceState({}, "", "/dashboard/usage");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  window.EventSource = originalEventSource;
  globalThis.ResizeObserver = originalResizeObserver;
  window.ResizeObserver = originalResizeObserver;
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("Usage page (Route Sheet)", () => {
  it("OverviewCards renders every usage figure", async () => {
    const { default: OverviewCards } = await import(
      "../../src/web/pages/dashboard/usage/components/OverviewCards.js"
    );
    const stats = {
      totalRequests: 4783,
      totalPromptTokens: 469500000,
      totalCachedTokens: 12000000,
      totalCompletionTokens: 3200000,
      totalCost: 51.38,
    };
    const { container, unmount } = await mount(React.createElement(OverviewCards, { stats }));

    const text = container.textContent;
    expect(text).toContain("4,783");
    expect(text).toContain("469.5M");
    expect(text).toContain("12M");
    expect(text).toContain("3.2M");
    expect(text).toContain("~$51.38");

    await unmount();
  });

  it("UsageTable expands grouped rows and renders a heading only when titled", async () => {
    const { default: UsageTable } = await import(
      "../../src/web/pages/dashboard/usage/components/UsageTable.js"
    );
    const groupedData = [
      {
        groupKey: "claude-opus-5-5",
        summary: {
          requests: 12,
          promptTokens: 5000,
          cachedTokens: 1000,
          completionTokens: 800,
          totalTokens: 5800,
          cost: 0.42,
          inputCost: 0.2,
          cachedCost: 0.02,
          outputCost: 0.2,
          pending: 0,
        },
        items: [
          {
            key: "cc:claude-opus-5-5",
            rawModel: "claude-opus-5-5",
            provider: "cc",
            requests: 12,
            promptTokens: 5000,
            cachedTokens: 1000,
            completionTokens: 800,
            totalTokens: 5800,
            cost: 0.42,
            inputCost: 0.2,
            cachedCost: 0.02,
            outputCost: 0.2,
            pending: 0,
          },
        ],
      },
    ];
    const props = {
      title: "",
      columns: [{ field: "rawModel", label: "Model" }],
      groupedData,
      tableType: "model",
      sortBy: "rawModel",
      sortOrder: "asc",
      onToggleSort: () => {},
      viewMode: "tokens",
      storageKey: "usage-test:expanded",
      renderSummaryCells: () => null,
      renderDetailCells: (item) =>
        React.createElement("td", { key: "m" }, item.provider),
      emptyMessage: "Empty",
    };

    const { container, unmount } = await mount(React.createElement(UsageTable, props));
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelectorAll("tr.group-detail").length).toBe(0);

    const summaryRow = container.querySelector("tr.group-summary");
    await act(async () => {
      summaryRow.click();
    });
    expect(container.querySelectorAll("tr.group-detail").length).toBe(1);
    await unmount();

    const withTitle = await mount(React.createElement(UsageTable, { ...props, title: "By model" }));
    const heading = withTitle.container.querySelector("h3");
    expect(heading?.textContent).toBe("By model");
    await withTitle.unmount();
  });

  it("UsageStats disables its period control while refetching", async () => {
    let resolveSecond;
    let statsCall = 0;
    const statsPayload = {
      totalRequests: 10,
      totalPromptTokens: 1200,
      totalCachedTokens: 0,
      totalCompletionTokens: 300,
      totalCost: 0.05,
      byModel: {},
      byAccount: {},
      byApiKey: {},
      byEndpoint: {},
      activeRequests: [],
      recentRequests: [],
    };
    globalThis.fetch = (url) => {
      const u = String(url);
      if (u.startsWith("/api/usage/stats")) {
        statsCall += 1;
        if (statsCall === 2) {
          return new Promise((resolve) => {
            resolveSecond = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(statsPayload) });
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(statsPayload) });
      }
      if (u.startsWith("/api/usage/chart")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ label: "00:00", tokens: 1500, cost: 0.05, requests: 10 }]),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ connections: [], nodes: [] }) });
    };

    const { default: UsageStats } = await import("../../src/shared/components/UsageStats.js");
    const { container, unmount } = await mount(React.createElement(UsageStats));

    const periodGroup = container.querySelector('[role="group"]');
    expect(periodGroup?.getAttribute("aria-disabled")).toBeNull();

    const btn7d = [...periodGroup.querySelectorAll("button")].find((b) => b.textContent === "7D");
    await act(async () => {
      btn7d.click();
    });

    expect(periodGroup.getAttribute("aria-disabled")).toBe("true");
    expect([...periodGroup.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);

    const btn30d = [...periodGroup.querySelectorAll("button")].find((b) => b.textContent === "30D");
    await act(async () => {
      btn30d.click();
    });
    expect(statsCall).toBe(2);

    await act(async () => {
      resolveSecond();
    });
    await flush();
    expect(periodGroup.getAttribute("aria-disabled")).toBeNull();
    expect([...periodGroup.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);

    await unmount();
  });

  it("UsagePage refetches on a period change and loads request details on the Details tab", async () => {
    const calls = [];
    globalThis.fetch = (url) => {
      const u = String(url);
      calls.push(u);
      if (u.startsWith("/api/usage/stats")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              totalRequests: 10,
              totalPromptTokens: 1200,
              totalCachedTokens: 0,
              totalCompletionTokens: 300,
              totalCost: 0.05,
              byModel: {},
              byAccount: {},
              byApiKey: {},
              byEndpoint: {},
              activeRequests: [],
              recentRequests: [],
            }),
        });
      }
      if (u.startsWith("/api/usage/chart")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ label: "00:00", tokens: 1500, cost: 0.05, requests: 10 }]),
        });
      }
      if (u.startsWith("/api/usage/request-details")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ details: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
        });
      }
      if (u.startsWith("/api/usage/providers")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ providers: [] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ connections: [], nodes: [] }) });
    };

    const { default: UsagePage } = await import("../../src/web/pages/dashboard/usage/page.js");
    const { container, unmount } = await mount(React.createElement(UsagePage));

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Usage");

    const btn7d = [...container.querySelectorAll("button")].find((b) => b.textContent === "7D");
    expect(btn7d).toBeDefined();
    await act(async () => {
      btn7d.click();
    });
    await flush();
    expect(calls.some((u) => u.includes("/api/usage/stats?period=7d"))).toBe(true);

    const btnDetails = [...container.querySelectorAll("button")].find((b) => b.textContent === "Details");
    expect(btnDetails).toBeDefined();
    await act(async () => {
      btnDetails.click();
    });
    await flush();
    expect(calls.some((u) => u.includes("/api/usage/request-details"))).toBe(true);

    await unmount();
  });
});
