import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React, { act } from "react";
import { vi } from "#test/vi";
import { setupDom, setupViewportStubs, mount, flush } from "#test/dom";

vi.mock("../../src/web/pages/dashboard/usage/components/ProviderTopology.js", () => ({
  default: () => React.createElement("div", { "data-topology-stub": "true" }),
}));

setupDom("http://localhost:20128/dashboard/usage");
setupViewportStubs();

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class MockEventSource {
  close() {}
}

const STATS = {
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

function respond(payload) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
}

function stubUsageFetch({ holdSecondStats = false } = {}) {
  const calls = [];
  let releaseSecondStats;
  globalThis.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("/api/usage/stats")) {
      if (holdSecondStats && calls.filter((c) => c.startsWith("/api/usage/stats")).length === 2) {
        return new Promise((resolve) => {
          releaseSecondStats = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(STATS) });
        });
      }
      return respond(STATS);
    }
    if (u.startsWith("/api/usage/chart")) return respond([{ label: "00:00", tokens: 1500, cost: 0.05, requests: 10 }]);
    if (u.startsWith("/api/usage/request-details")) {
      return respond({ details: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
    }
    if (u.startsWith("/api/usage/providers")) return respond({ providers: [] });
    return respond({ connections: [], nodes: [] });
  };
  return { calls, release: () => releaseSecondStats() };
}

const buttonByText = (container, text) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => {
  globalThis.EventSource = MockEventSource;
  window.EventSource = MockEventSource;
  window.history.replaceState({}, "", "/dashboard/usage");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  window.EventSource = originalEventSource;
  document.body.innerHTML = "";
});

describe("Usage page (Route Sheet)", () => {
  it("UsageTable expands grouped rows and renders a heading only when titled", async () => {
    const { default: UsageTable } = await import(
      "../../src/web/pages/dashboard/usage/components/UsageTable.js"
    );
    const metrics = {
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
    };
    const props = {
      title: "",
      columns: [{ field: "rawModel", label: "Model" }],
      groupedData: [
        {
          groupKey: "claude-opus-5-5",
          summary: metrics,
          items: [{ key: "cc:claude-opus-5-5", rawModel: "claude-opus-5-5", provider: "cc", ...metrics }],
        },
      ],
      tableType: "model",
      sortBy: "rawModel",
      sortOrder: "asc",
      onToggleSort: () => {},
      viewMode: "tokens",
      storageKey: "usage-test:expanded",
      renderSummaryCells: () => null,
      renderDetailCells: (item) => React.createElement("td", { key: "m" }, item.provider),
      emptyMessage: "Empty",
    };

    const { container, unmount } = await mount(React.createElement(UsageTable, props), { settle: true });
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelectorAll("tr.group-detail").length).toBe(0);

    await act(async () => {
      container.querySelector("tr.group-summary").click();
    });
    expect(container.querySelectorAll("tr.group-detail").length).toBe(1);
    await unmount();

    const withTitle = await mount(React.createElement(UsageTable, { ...props, title: "By model" }), { settle: true });
    expect(withTitle.container.querySelector("h3")?.textContent).toBe("By model");
    await withTitle.unmount();
  });

  it("UsageStats disables its period control while refetching", async () => {
    const { calls, release } = stubUsageFetch({ holdSecondStats: true });

    const { default: UsageStats } = await import("../../src/shared/components/UsageStats.js");
    const { container, unmount } = await mount(React.createElement(UsageStats), { settle: true });

    const periodGroup = container.querySelector('[role="group"]');
    expect(periodGroup?.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      buttonByText(periodGroup, "7D").click();
    });

    expect(periodGroup.getAttribute("aria-disabled")).toBe("true");
    expect([...periodGroup.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);

    await act(async () => {
      buttonByText(periodGroup, "30D").click();
    });
    expect(calls.filter((c) => c.startsWith("/api/usage/stats"))).toHaveLength(2);

    await act(async () => {
      release();
    });
    await flush();
    expect(periodGroup.getAttribute("aria-disabled")).toBeNull();
    expect([...periodGroup.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);

    await unmount();
  });

  it("UsagePage shows the usage figures, refetches on a period change and loads request details on the Details tab", async () => {
    const { calls } = stubUsageFetch();

    const { default: UsagePage } = await import("../../src/web/pages/dashboard/usage/page.js");
    const { container, unmount } = await mount(React.createElement(UsagePage), { settle: true });

    expect(container.querySelector("h1")?.textContent).toBe("Usage");
    expect(container.textContent).toContain("1.2K");
    expect(container.textContent).toContain("~$0.05");

    await act(async () => {
      buttonByText(container, "7D").click();
    });
    await flush();
    expect(calls.some((u) => u.includes("/api/usage/stats?period=7d"))).toBe(true);

    await act(async () => {
      buttonByText(container, "Details").click();
    });
    await flush();
    expect(calls.some((u) => u.includes("/api/usage/request-details"))).toBe(true);

    await unmount();
  });
});
