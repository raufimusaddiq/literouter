import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { setupDom, setupViewportStubs, mount, click, flush, stubReload } from "#test/dom";
import { BUILD_HEADER } from "../../src/shared/utils/buildEntry.js";

setupDom();
setupViewportStubs();

const OWN_ENTRY = "/assets/index-own.js";
const NEW_ENTRY = "/assets/index-new.js";

let entryScript;
let originalFetch;
let unwatch;
let stubbed;

function stubFetch(url, headers) {
  stubbed = { url: `http://localhost${url}`, headers: new Headers(headers), ok: true };
  globalThis.fetch = window.fetch = async () => stubbed;
}

beforeEach(async () => {
  window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  originalFetch = window.fetch;
  entryScript = document.createElement("script");
  entryScript.type = "module";
  entryScript.setAttribute("src", OWN_ENTRY);
  document.head.appendChild(entryScript);
});

afterEach(() => {
  unwatch?.();
  unwatch = null;
  entryScript.remove();
  globalThis.fetch = window.fetch = originalFetch;
});

async function start(url, headers) {
  stubFetch(url, headers);
  const { watchBuild } = await import("../../src/web/buildWatch.js");
  const { default: UpdateBanner } = await import("../../src/shared/components/shell/UpdateBanner.js");
  unwatch = watchBuild();
  const view = await mount(<UpdateBanner />);
  return view;
}

async function callApi(view) {
  await act(async () => {
    await window.fetch("/api/anything");
  });
  await flush();
  return view.container.textContent.includes("New version available");
}

const buttonLabelled = (view, label) => [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);

describe("update notice", () => {
  it.each([
    ["an API response from the running build", "/api/anything", { [BUILD_HEADER]: OWN_ENTRY }, false],
    ["an API response from a newer build", "/api/anything", { [BUILD_HEADER]: NEW_ENTRY }, true],
    ["an API response with no build header", "/api/anything", {}, false],
    ["a newer build header on a non-API URL", "/assets/chunk.js", { [BUILD_HEADER]: NEW_ENTRY }, false],
  ])("%s", async (_name, url, headers, expected) => {
    const view = await start(url, headers);
    expect(await callApi(view)).toBe(expected);
    await view.unmount();
  });

  it("returns the original response untouched", async () => {
    const view = await start("/api/anything", { [BUILD_HEADER]: OWN_ENTRY });
    expect(await window.fetch("/api/anything")).toBe(stubbed);
    await view.unmount();
  });

  it("passes a fetch failure through unchanged", async () => {
    const failure = new Error("offline");
    globalThis.fetch = window.fetch = async () => Promise.reject(failure);
    const { watchBuild } = await import("../../src/web/buildWatch.js");
    unwatch = watchBuild();
    await expect(window.fetch("/api/anything")).rejects.toBe(failure);
  });

  it("leaves fetch alone when the running entry cannot be found", async () => {
    entryScript.remove();
    stubFetch("/api/anything", { [BUILD_HEADER]: NEW_ENTRY });
    const before = window.fetch;
    const { watchBuild } = await import("../../src/web/buildWatch.js");
    unwatch = watchBuild();
    expect(window.fetch).toBe(before);
  });

  it("Reload reloads the page", async () => {
    const reload = stubReload();
    const view = await start("/api/anything", { [BUILD_HEADER]: NEW_ENTRY });
    await callApi(view);
    await click(buttonLabelled(view, "Reload"));
    expect(reload).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("Dismiss hides it", async () => {
    const view = await start("/api/anything", { [BUILD_HEADER]: NEW_ENTRY });
    await callApi(view);
    await click(view.container.querySelector('button[aria-label="Dismiss"]'));
    expect(view.container.textContent).not.toContain("New version available");
    await view.unmount();
  });
});
