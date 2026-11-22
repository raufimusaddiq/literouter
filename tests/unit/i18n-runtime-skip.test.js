import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Minimal DOM stubs: the runtime only needs cookies, a body, a tree walker,
// and a MutationObserver constructor.
function installDom(cookie) {
  const walker = { nextNode: () => null };
  const doc = {
    cookie,
    body: {},
    createTreeWalker: vi.fn(() => walker),
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", doc);
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  vi.stubGlobal("Node", { ELEMENT_NODE: 1, TEXT_NODE: 3 });
  vi.stubGlobal("MutationObserver", class { observe() {} });
  return doc;
}

describe("i18n runtime", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips DOM passes while the locale stays English", async () => {
    const doc = installDom("locale=en");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { initRuntimeI18n, reloadTranslations } = await import("@/i18n/runtime");

    await initRuntimeI18n();
    await reloadTranslations();

    expect(doc.createTreeWalker).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads a locale's literals once and still restores DOM when switching back to English", async () => {
    const doc = installDom("locale=vi");
    const fetchMock = vi.fn(async () => ({ json: async () => ({ Hello: "Xin chào" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { initRuntimeI18n, reloadTranslations, translate } = await import("@/i18n/runtime");

    await initRuntimeI18n();
    await reloadTranslations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(translate("Hello")).toBe("Xin chào");
    expect(doc.createTreeWalker).toHaveBeenCalledTimes(2);

    doc.cookie = "locale=en";
    await reloadTranslations();
    expect(translate("Hello")).toBe("Hello");
    expect(doc.createTreeWalker).toHaveBeenCalledTimes(3);
  });

  it("retries the fetch after a failed load", async () => {
    installDom("locale=vi");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ json: async () => ({ Hello: "Xin chào" }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { reloadTranslations, translate } = await import("@/i18n/runtime");

    await reloadTranslations();
    expect(translate("Hello")).toBe("Hello");
    await reloadTranslations();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(translate("Hello")).toBe("Xin chào");
  });
});
