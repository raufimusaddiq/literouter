import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost:20128/dashboard" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = typeof window !== "undefined" ? window.matchMedia : undefined;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeConnections(count = 6) {
  const base = [
    { id: "c-ts", provider: "ts", name: "jevkey", testStatus: "active", isActive: true },
    { id: "c-sumo", provider: "sumo", name: "", testStatus: "active", isActive: true },
    { id: "c-kn", provider: "kn", email: "musaddiq@gmail.com", testStatus: "active", isActive: true },
    { id: "c-ocg", provider: "ocg", email: "raufi@gmail.com", testStatus: "active", isActive: true },
    { id: "c-cc", provider: "cc", email: "raufi@gmail.com", testStatus: "active", isActive: true },
    { id: "c-mimo", provider: "mimo", name: "", testStatus: "active", isActive: true },
  ];
  if (count <= base.length) return base.slice(0, count);
  const extra = [];
  for (let i = base.length; i < count; i += 1) {
    extra.push({
      id: `c-extra-${i}`,
      provider: `prov-${i}`,
      name: `acct-${i}`,
      testStatus: "active",
      isActive: true,
    });
  }
  return [...base, ...extra];
}

function makeRecentRequests(count = 5) {
  const now = Date.now();
  const base = [
    { timestamp: new Date(now - 1000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 173700, completionTokens: 3, status: "ok" },
    { timestamp: new Date(now - 2000).toISOString(), model: "muse-ember-1-0", provider: "kn", promptTokens: 79900, completionTokens: 110, status: "ok" },
    { timestamp: new Date(now - 12000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 72900, completionTokens: 513, status: "ok" },
    { timestamp: new Date(now - 31000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 71000, completionTokens: 4000, status: "ok" },
    { timestamp: new Date(now - 44000).toISOString(), model: "muse-ember-1-0", provider: "kn", promptTokens: 170800, completionTokens: 94, status: "ok" },
  ];
  if (count <= base.length) return base.slice(0, count);
  const extra = [];
  for (let i = base.length; i < count; i += 1) {
    extra.push({
      timestamp: new Date(now - (i + 1) * 60000).toISOString(),
      model: `model-extra-${i}`,
      provider: `prov-${i}`,
      promptTokens: 12000,
      completionTokens: 250,
      status: "ok",
    });
  }
  return [...base, ...extra];
}

function makeBuckets() {
  const vals = [270, 150, 145, 45, 215, 340, 330, 5, 5, 5, 5, 8, 5, 20, 395, 255, 30, 40, 160, 775, 790, 10, 345, 520];
  return vals.map((requests, i) => ({
    label: `${String(i).padStart(2, "0")}:00`,
    requests,
  }));
}

function makeNodes() {
  return [
    { id: "ts", name: "TypeSafe AI" },
    { id: "sumo", name: "Sumopod" },
    { id: "kn", name: "Kenari" },
    { id: "ocg", name: "OpenCode Go" },
    { id: "cc", name: "Claude Code" },
    { id: "mimo", name: "MiMo Code Free" },
  ];
}

function jsonResponse(payload, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  });
}

function stubFetch({
  connections = makeConnections(6),
  keys = Array.from({ length: 7 }, (_, i) => ({ id: `k-${i}`, isActive: true })),
  settings = { requireApiKey: true, requireLogin: true, hasPassword: true },
  nodes = makeNodes(),
  buckets = makeBuckets(),
  stats = {
    totalRequests: 4783,
    totalPromptTokens: 469500000,
    totalCompletionTokens: 3200000,
    totalCost: 51.38,
    recentRequests: makeRecentRequests(5),
  },
  usageFail = false,
} = {}) {
  const calls = [];
  globalThis.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("/api/providers")) return jsonResponse({ connections });
    if (u.startsWith("/api/keys")) return jsonResponse({ keys });
    if (u.startsWith("/api/settings")) return jsonResponse(settings);
    if (u.startsWith("/api/provider-nodes")) return jsonResponse({ nodes });
    if (u.startsWith("/api/usage/chart")) {
      return usageFail ? jsonResponse({ error: "fail" }, 500) : jsonResponse(buckets);
    }
    if (u.startsWith("/api/usage/stats")) {
      return usageFail ? jsonResponse({ error: "fail" }, 500) : jsonResponse(stats);
    }
    return jsonResponse({});
  };
  return calls;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}

async function mountOverview() {
  const { default: DashboardOverview } = await import("../../src/web/pages/dashboard/DashboardOverview.js");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(DashboardOverview));
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
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  window.ResizeObserver = originalResizeObserver;
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("DashboardOverview (Route Sheet)", () => {
  it("renders the traffic totals", async () => {
    stubFetch();
    const { container, unmount } = await mountOverview();

    const text = container.textContent;
    expect(text).toContain("4,783");
    expect(text).toContain("469.5M");
    expect(text).toContain("3.2M");
    expect(text).toContain("~$51.38");
    expect(text).toContain("now 520");

    await unmount();
  });

  it("renders the Providers summary, needs-attention link and hit counts", async () => {
    stubFetch();
    const { container, unmount } = await mountOverview();

    const headings = [...container.querySelectorAll("h2")];
    const provHeading = headings.find((h) => h.textContent === "Providers");
    expect(provHeading).toBeDefined();
    const headerRow = provHeading.closest("[data-col-head]") || provHeading.parentElement;
    expect(headerRow.textContent).toContain("6 connections · 6 ready · 0 need attention");

    const attentionLink = container.querySelector('a[href="/dashboard/providers#needs-attention"]');
    expect(attentionLink).not.toBeNull();

    const text = container.textContent;
    expect(text).toContain("3 of last 5");
    expect(text).toContain("2 of last 5");
    expect(text).toContain("0 inactive · 0 untested");
    expect(text).toContain("from 7 active keys");

    await unmount();
  });

  it("caps the request and provider lists at 6 rows", async () => {
    stubFetch({
      connections: makeConnections(40),
      stats: {
        totalRequests: 12000,
        totalPromptTokens: 900000000,
        totalCompletionTokens: 5400000,
        totalCost: 112.5,
        recentRequests: makeRecentRequests(10),
      },
    });
    const { container, unmount } = await mountOverview();

    const reqRows = container.querySelectorAll("[data-route-requests] li");
    const provRows = container.querySelectorAll("[data-route-providers] li");
    expect(reqRows.length).toBe(6);
    expect(provRows.length).toBe(6);

    await unmount();
  });

  it("refetches stats and chart when the period changes", async () => {
    const calls = stubFetch();
    const { container, unmount } = await mountOverview();

    const btn7d = [...container.querySelectorAll("button")].find((b) => b.textContent === "7D");
    expect(btn7d).toBeDefined();
    await act(async () => {
      btn7d.click();
    });
    await flush();
    expect(calls.some((u) => u.includes("/api/usage/stats?period=7d"))).toBe(true);
    expect(calls.some((u) => u.includes("/api/usage/chart?period=7d"))).toBe(true);
    await unmount();
  });

  it("shows the empty state with add-provider and needs-attention links when there is no traffic", async () => {
    stubFetch({ connections: [], stats: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, recentRequests: [] } });
    const { container, unmount } = await mountOverview();
    expect(container.textContent).toContain("No traffic yet.");
    expect(container.querySelector('a[href="/dashboard/providers/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard/providers#needs-attention"]')).not.toBeNull();
    await unmount();
  });

  it("shows an error message when usage data fails to load", async () => {
    stubFetch({ usageFail: true });
    const { container, unmount } = await mountOverview();
    expect(container.textContent).toContain("Usage data could not be loaded.");
    await unmount();
  });

  it("RouteWires draws an aria-hidden SVG and renders nothing when its container is hidden", async () => {
    const { default: RouteWires } = await import("../../src/web/pages/dashboard/overview/RouteWires.js");

    function Harness({ hidden }) {
      const containerRef = React.useRef(null);
      const requestRefs = React.useRef([]);
      const providerRefs = React.useRef([]);
      return React.createElement(
        "div",
        null,
        React.createElement(
          "ul",
          null,
          React.createElement("li", { ref: (el) => { requestRefs.current[0] = el; } }, "r0"),
        ),
        React.createElement(
          "div",
          {
            ref: containerRef,
            style: hidden ? { display: "none" } : { display: "block", width: "200px", height: "120px" },
          },
          React.createElement(RouteWires, {
            containerRef,
            requestRefs,
            providerRefs,
            links: [{ from: 0, to: 0 }],
            hot: new Set(["cc"]),
            newest: 0,
            requestCount: 1,
            providerCount: 1,
          }),
        ),
        React.createElement(
          "ul",
          null,
          React.createElement("li", { "data-provider": "cc", ref: (el) => { providerRefs.current[0] = el; } }, "p0"),
        ),
      );
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Harness, { hidden: false }));
    });
    await flush();

    const svg = host.querySelector('svg[aria-hidden="true"]');
    expect(svg).not.toBeNull();

    await act(async () => {
      root.render(React.createElement(Harness, { hidden: true }));
    });
    await flush();

    expect(host.querySelector('svg[aria-hidden="true"]')).toBeNull();

    await act(async () => {
      root.unmount();
      host.remove();
    });
  });

  it("RouteWires keeps row alignment when a ref slot is null and skips null endpoints", async () => {
    const { default: RouteWires } = await import("../../src/web/pages/dashboard/overview/RouteWires.js");

    function SparseHarness() {
      const containerRef = React.useRef(null);
      const requestRefs = React.useRef([null, null]);
      const providerRefs = React.useRef([null, null]);
      return React.createElement(
        "div",
        null,
        React.createElement(
          "ul",
          null,
          React.createElement("li", { ref: (el) => { requestRefs.current[1] = el; } }, "r1"),
        ),
        React.createElement(
          "div",
          {
            ref: containerRef,
            style: { display: "block", width: "200px", height: "200px" },
          },
          React.createElement(RouteWires, {
            containerRef,
            requestRefs,
            providerRefs,
            links: [
              { from: 0, to: 0 },
              { from: 1, to: 1 },
            ],
            hot: new Set(["cc"]),
            newest: 1,
            requestCount: 2,
            providerCount: 2,
          }),
        ),
        React.createElement(
          "ul",
          null,
          React.createElement("li", { "data-provider": "cc", ref: (el) => { providerRefs.current[1] = el; } }, "p1"),
        ),
      );
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(SparseHarness));
    });
    await flush();

    const svg = host.querySelector('svg[aria-hidden="true"]');
    expect(svg).not.toBeNull();
    const livePaths = [...svg.querySelectorAll(".lr-wire-live")];
    expect(livePaths.length).toBe(2);
    expect(livePaths[0].getAttribute("d")).toContain("M-6,121");
    expect(livePaths[1].getAttribute("d")).toContain("206,121");
    expect(svg.querySelectorAll("path").length).toBe(2);

    await act(async () => {
      root.unmount();
      host.remove();
    });
  });
});
