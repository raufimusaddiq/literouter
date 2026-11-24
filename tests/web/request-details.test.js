import { describe, it, expect, afterEach } from "bun:test";
import React, { act } from "react";
import { setupDom, setupViewportStubs, mount, flush, click } from "#test/dom";
import RequestDetailsTab from "../../src/web/pages/dashboard/usage/components/RequestDetailsTab.js";

setupDom("http://localhost:20128/dashboard/usage");
setupViewportStubs();

const originalFetch = globalThis.fetch;

function detail(overrides = {}) {
  return {
    id: "2026-11-24T03:49:54.351Z-abc",
    timestamp: "2026-11-24T03:49:54.351Z",
    provider: "kenari",
    model: "deepseek-v4-1-flash",
    status: "success",
    latency: { ttft: 3376, total: 3376 },
    tokens: { prompt_tokens: 1336, completion_tokens: 97 },
    ...overrides,
  };
}

function stubFetch(details) {
  globalThis.fetch = (url) => {
    const body = String(url).startsWith("/api/usage/request-details")
      ? { details, pagination: { page: 1, pageSize: 20, totalItems: details.length, totalPages: 1 } }
      : { nodes: [], providers: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

async function openDrawer(details) {
  stubFetch(details);
  const view = await mount(React.createElement(RequestDetailsTab), { settle: true });
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Detail");
  await click(button);
  await flush();
  return view;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

describe("request details drawer", () => {
  it("explains redacted bodies instead of printing the redaction marker", async () => {
    const redacted = { redacted: true };
    await openDrawer([detail({ request: redacted, providerRequest: redacted, providerResponse: redacted, response: redacted })]);
    const text = document.body.textContent;
    expect(text).toContain("Request and response bodies are redacted here");
    expect(text).not.toContain('"redacted"');
    expect(text).not.toContain("Client request");
  });

  it("lists stored payloads as numbered rows with the client request open", async () => {
    await openDrawer([detail({ request: { model: "m", messages: [] }, response: { content: "hello" } })]);
    const text = document.body.textContent;
    expect(text).toContain("01Client request");
    expect(text).toContain('"messages": []');
    expect(text).toContain("02Client response");
    expect(text).toContain("hello");
  });

  it("labels empty date filters as any time and enables Clear once one is set", async () => {
    stubFetch([]);
    const view = await mount(React.createElement(RequestDetailsTab), { settle: true });
    const from = document.getElementById("start-date-filter");
    const clear = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Clear");
    expect(from.type).toBe("datetime-local");
    expect(from.parentElement.textContent).toContain("Any time");
    expect(clear.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(from, "2026-11-24T10:00");
      from.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(from.parentElement.textContent).not.toContain("Any time");
    expect(clear.disabled).toBe(false);
    await view.unmount();
  });
});
