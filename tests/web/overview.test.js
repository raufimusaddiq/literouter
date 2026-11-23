import { describe, it, expect, afterEach } from "bun:test";
import React, { act } from "react";
import { setupDom, setupViewportStubs, mount, flush } from "#test/dom";

setupDom("http://localhost:20128/dashboard");
setupViewportStubs();

const originalFetch = globalThis.fetch;

function makeConnections() {
  return [
    { id: "c-ts", provider: "ts", name: "jevkey", testStatus: "active", isActive: true },
    { id: "c-sumo", provider: "sumo", name: "", testStatus: "active", isActive: true },
    { id: "c-kn", provider: "kn", email: "musaddiq@gmail.com", testStatus: "active", isActive: true },
    { id: "c-ocg", provider: "ocg", email: "raufi@gmail.com", testStatus: "active", isActive: true },
    { id: "c-cc", provider: "cc", email: "raufi@gmail.com", testStatus: "active", isActive: true },
    { id: "c-mimo", provider: "mimo", name: "", testStatus: "active", isActive: true },
  ];
}

function makeRecentRequests() {
  const now = Date.now();
  return [
    { timestamp: new Date(now - 1000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 173700, completionTokens: 3, status: "ok" },
    { timestamp: new Date(now - 2000).toISOString(), model: "muse-ember-1-0", provider: "kn", promptTokens: 79900, completionTokens: 110, status: "ok" },
    { timestamp: new Date(now - 12000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 72900, completionTokens: 513, status: "ok" },
    { timestamp: new Date(now - 31000).toISOString(), model: "claude-opus-5-5", provider: "cc", promptTokens: 71000, completionTokens: 4000, status: "ok" },
    { timestamp: new Date(now - 44000).toISOString(), model: "muse-ember-1-0", provider: "kn", promptTokens: 170800, completionTokens: 94, status: "ok" },
  ];
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

function makeStats(overrides = {}) {
  return {
    totalRequests: 4783,
    totalPromptTokens: 469500000,
    totalCompletionTokens: 3200000,
    totalCost: 51.38,
    recentRequests: makeRecentRequests(),
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  });
}

function stubFetch({
  connections = makeConnections(),
  stats = makeStats(),
  usageFail = false,
} = {}) {
  const calls = [];
  globalThis.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("/api/providers")) return jsonResponse({ connections });
    if (u.startsWith("/api/keys")) return jsonResponse({ keys: Array.from({ length: 7 }, (_, i) => ({ id: `k-${i}`, isActive: true })) });
    if (u.startsWith("/api/settings")) return jsonResponse({ requireApiKey: true, requireLogin: true, hasPassword: true });
    if (u.startsWith("/api/provider-nodes")) return jsonResponse({ nodes: makeNodes() });
    if (u.startsWith("/api/usage/chart")) {
      return usageFail ? jsonResponse({ error: "fail" }, 500) : jsonResponse(makeBuckets());
    }
    if (u.startsWith("/api/usage/stats")) {
      return usageFail ? jsonResponse({ error: "fail" }, 500) : jsonResponse(stats);
    }
    return jsonResponse({});
  };
  return calls;
}

async function mountOverview() {
  const { default: DashboardOverview } = await import("../../src/web/pages/dashboard/DashboardOverview.js");
  return mount(React.createElement(DashboardOverview), { settle: true });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

describe("DashboardOverview (Route Sheet)", () => {
  it("renders the traffic totals and the Providers summary", async () => {
    stubFetch();
    const { container, unmount } = await mountOverview();

    const text = container.textContent;
    expect(text).toContain("4,783");
    expect(text).toContain("469.5M");
    expect(text).toContain("3.2M");
    expect(text).toContain("~$51.38");
    expect(text).toContain("now 520");
    expect(text).toContain("6 connections · 6 ready · 0 need attention");
    expect(text).toContain("3 of last 5");
    expect(text).toContain("2 of last 5");
    expect(text).toContain("0 inactive · 0 untested");
    expect(text).toContain("from 7 active keys");
    expect(container.querySelector('a[href="/dashboard/providers#needs-attention"]')).not.toBeNull();

    await unmount();
  });

  it("caps the request and provider lists at 6 rows", async () => {
    stubFetch({
      connections: Array.from({ length: 40 }, (_, i) => ({
        id: `c-${i}`,
        provider: `prov-${i}`,
        name: `acct-${i}`,
        testStatus: "active",
        isActive: true,
      })),
      stats: makeStats({
        recentRequests: Array.from({ length: 10 }, (_, i) => ({
          timestamp: new Date(Date.now() - (i + 1) * 60000).toISOString(),
          model: `model-${i}`,
          provider: `prov-${i}`,
          promptTokens: 12000,
          completionTokens: 250,
          status: "ok",
        })),
      }),
    });
    const { container, unmount } = await mountOverview();

    expect(container.querySelectorAll("[data-route-requests] li").length).toBe(6);
    expect(container.querySelectorAll("[data-route-providers] li").length).toBe(6);

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
    stubFetch({
      connections: [],
      stats: makeStats({ totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, recentRequests: [] }),
    });
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

  describe("RouteWires", () => {
    function Harness({ hidden = false, sparse = false, RouteWires }) {
      const slot = sparse ? 1 : 0;
      const count = slot + 1;
      const containerRef = React.useRef(null);
      const requestRefs = React.useRef(Array(count).fill(null));
      const providerRefs = React.useRef(Array(count).fill(null));
      return (
        <div>
          <ul>
            <li ref={(el) => { requestRefs.current[slot] = el; }}>r</li>
          </ul>
          <div ref={containerRef} style={hidden ? { display: "none" } : { display: "block", width: "200px", height: "200px" }}>
            <RouteWires
              containerRef={containerRef}
              requestRefs={requestRefs}
              providerRefs={providerRefs}
              links={Array.from({ length: count }, (_, i) => ({ from: i, to: i }))}
              hot={new Set(["cc"])}
              newest={slot}
              requestCount={count}
              providerCount={count}
            />
          </div>
          <ul>
            <li data-provider="cc" ref={(el) => { providerRefs.current[slot] = el; }}>p</li>
          </ul>
        </div>
      );
    }

    it("draws an aria-hidden SVG and renders nothing when its container is hidden", async () => {
      const { default: RouteWires } = await import("../../src/web/pages/dashboard/overview/RouteWires.js");
      const view = await mount(<Harness RouteWires={RouteWires} />, { settle: true });

      expect(view.container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

      await view.rerender(<Harness RouteWires={RouteWires} hidden />);
      await flush();

      expect(view.container.querySelector('svg[aria-hidden="true"]')).toBeNull();
      await view.unmount();
    });

    it("keeps row alignment when a ref slot is null and skips null endpoints", async () => {
      const { default: RouteWires } = await import("../../src/web/pages/dashboard/overview/RouteWires.js");
      const view = await mount(<Harness RouteWires={RouteWires} sparse />, { settle: true });

      const svg = view.container.querySelector('svg[aria-hidden="true"]');
      expect(svg).not.toBeNull();
      const livePaths = [...svg.querySelectorAll(".lr-wire-live")];
      expect(livePaths.length).toBe(2);
      expect(livePaths[0].getAttribute("d")).toContain("M-6,121");
      expect(livePaths[1].getAttribute("d")).toContain("206,121");
      expect(svg.querySelectorAll("path").length).toBe(2);

      await view.unmount();
    });
  });
});
