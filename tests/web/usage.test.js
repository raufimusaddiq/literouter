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
  it("OverviewCards renders the big-number line with all 5 figures and labels", async () => {
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
    expect(text).toContain("Total requests");
    expect(text).toContain("Input tokens");
    expect(text).toContain("Cached tokens");
    expect(text).toContain("Output tokens");
    expect(text).toContain("Estimated cost");
    expect(text).toContain("~$51.38");
    expect(container.querySelectorAll("strong").length).toBe(5);

    await unmount();
  });

  it("UsageTable renders no heading when title is empty and expands grouped rows", async () => {
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
    expect(withTitle.container.querySelector("h3")?.textContent).toBe("By model");
    await withTitle.unmount();
  });

  it("UsagePage renders PageHeader and switches tabs and period windows", async () => {
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
    expect(h1?.className).toContain("text-[24px]");

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
