import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/dashboard" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

let currentWidth = 1440;
let reducedMotion = false;
const originalMatchMedia = typeof window !== "undefined" ? window.matchMedia : undefined;
const originalResizeObserver = globalThis.ResizeObserver;
const resizeObserverInstances = [];

function evaluateMediaQuery(query, width) {
  const minMatch = query.match(/\(min-width:\s*(\d+)px\)/);
  const maxMatch = query.match(/\(max-width:\s*(\d+)px\)/);
  if (query.includes("prefers-reduced-motion")) {
    return reducedMotion;
  }
  let ok = true;
  if (minMatch) ok = ok && width >= Number(minMatch[1]);
  if (maxMatch) ok = ok && width <= Number(maxMatch[1]);
  return ok;
}

function stubViewport(width, { reduced = false } = {}) {
  currentWidth = width;
  reducedMotion = reduced;
  window.matchMedia = (query) => ({
    matches: evaluateMediaQuery(query, currentWidth),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.elements = [];
    resizeObserverInstances.push(this);
  }
  observe(el) {
    this.elements.push(el);
  }
  unobserve(el) {
    this.elements = this.elements.filter((item) => item !== el);
  }
  disconnect() {
    this.elements = [];
  }
  trigger() {
    this.callback(
      this.elements.map((target) => ({ target })),
      this,
    );
  }
}

beforeEach(() => {
  resizeObserverInstances.length = 0;
  stubViewport(1440);
  globalThis.ResizeObserver = MockResizeObserver;
  window.ResizeObserver = MockResizeObserver;
  document.body.style.overflow = "";
});

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  globalThis.ResizeObserver = originalResizeObserver;
  window.ResizeObserver = originalResizeObserver;
  document.body.style.overflow = "";
});

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    rerender: (next) =>
      act(async () => {
        root.render(next);
      }),
    unmount: () =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
  };
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

describe("Route Sheet shell", () => {
  it("desktop nav marks only the current page", async () => {
    stubViewport(1440);
    window.history.replaceState(null, "", "/dashboard/usage");
    const { default: DashboardLayout } = await import("../../src/shared/components/layouts/DashboardLayout.js");
    const view = await mount(
      <DashboardLayout>
        <h1>Usage</h1>
      </DashboardLayout>,
    );

    const links = [...view.container.querySelectorAll("nav a")];
    const current = links.filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent.trim()).toBe("Usage");
    expect(current[0].getAttribute("href")).toBe("/dashboard/usage");

    await view.unmount();
  });

  it("nav folds into a Menu button when it overflows", async () => {
    stubViewport(1440);
    window.history.replaceState(null, "", "/dashboard");
    const { default: TopBar } = await import("../../src/shared/components/shell/TopBar.js");
    const view = await mount(<TopBar onOpenMenu={() => {}} />);

    const nav = view.container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(view.container.querySelectorAll("nav a").length).toBeGreaterThan(0);

    Object.defineProperty(nav, "scrollWidth", { configurable: true, value: 1400 });
    Object.defineProperty(nav, "clientWidth", { configurable: true, value: 900 });

    await act(async () => {
      for (const observer of resizeObserverInstances) {
        observer.trigger();
      }
    });

    const menuButton = [...view.container.querySelectorAll("button[aria-expanded]")].find(
      (btn) => btn.textContent.trim() === "Menu",
    );
    expect(menuButton).not.toBeUndefined();
    expect(view.container.querySelectorAll("nav a")).toHaveLength(0);

    await view.unmount();
  });

  it("tablet Menu button opens the full nav sheet as a labelled dialog", async () => {
    stubViewport(1280);
    window.history.replaceState(null, "", "/dashboard/providers");
    const { default: DashboardLayout } = await import("../../src/shared/components/layouts/DashboardLayout.js");
    const view = await mount(
      <DashboardLayout>
        <h1>Providers</h1>
      </DashboardLayout>,
    );

    expect(view.container.querySelectorAll("header nav a")).toHaveLength(0);
    const menuButton = [...view.container.querySelectorAll("button[aria-expanded]")].find(
      (btn) => btn.textContent.trim() === "Menu",
    );
    expect(menuButton).not.toBeUndefined();
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    await click(menuButton);

    const dialog = view.container.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(document.getElementById(labelId)?.textContent.trim()).toBe("All pages");
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");

    await view.unmount();
  });

  it("phone tab bar marks More active on a non-primary page", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/combos");
    const { default: DashboardLayout } = await import("../../src/shared/components/layouts/DashboardLayout.js");
    const view = await mount(
      <DashboardLayout>
        <h1>Combos</h1>
      </DashboardLayout>,
    );

    const tabBar = view.container.querySelector('nav[aria-label="Primary navigation"]');
    expect(tabBar).not.toBeNull();
    const targets = [...tabBar.querySelectorAll("a, button")];

    const moreButton = targets.find((el) => el.textContent.trim().includes("More"));
    expect(moreButton).not.toBeUndefined();
    expect(moreButton.getAttribute("aria-current")).toBe("page");

    const activeLinks = targets.filter((el) => el !== moreButton && el.getAttribute("aria-current") === "page");
    expect(activeLinks).toHaveLength(0);

    await view.unmount();
  });

  it("More sheet is a modal dialog that closes on Escape and restores focus to More", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/combos");
    const { default: DashboardLayout } = await import("../../src/shared/components/layouts/DashboardLayout.js");
    const view = await mount(
      <DashboardLayout>
        <h1>Combos</h1>
      </DashboardLayout>,
    );

    const tabBar = view.container.querySelector('nav[aria-label="Primary navigation"]');
    const moreButton = [...tabBar.querySelectorAll("button")].find((btn) => btn.textContent.includes("More"));
    expect(moreButton).not.toBeUndefined();

    await act(async () => {
      moreButton.focus();
    });
    await click(moreButton);

    const dialog = view.container.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId)?.textContent.trim()).toBe("All pages");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await pressEscape();

    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement === moreButton).toBe(true);
    expect(document.body.style.overflow).toBe("");

    await view.unmount();
  });

  it("More sheet traps Tab inside the dialog", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/combos");
    const { default: NavSheet } = await import("../../src/shared/components/shell/NavSheet.js");
    const view = await mount(<NavSheet open onClose={() => {}} variant="bottom" />);

    const dialog = view.container.querySelector('[role="dialog"]');
    const focusables = [...dialog.querySelectorAll('a[href], button:not([disabled])')];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    await act(async () => {
      last.focus();
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement === first).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement === last).toBe(true);

    await view.unmount();
  });

  it("tab bar hides while a text field is focused", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/endpoint");
    const { default: DashboardLayout } = await import("../../src/shared/components/layouts/DashboardLayout.js");
    const view = await mount(
      <DashboardLayout>
        <input id="key-name" type="text" aria-label="Key name" />
      </DashboardLayout>,
    );

    const tabBar = view.container.querySelector('nav[aria-label="Primary navigation"]');
    const input = view.container.querySelector("#key-name");
    expect(tabBar.hidden).toBe(false);

    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(tabBar.hidden).toBe(true);

    await act(async () => {
      input.blur();
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(tabBar.hidden).toBe(false);

    await view.unmount();
  });

  it("Escape closes only the topmost layer", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/combos");
    const { default: NavSheet } = await import("../../src/shared/components/shell/NavSheet.js");
    const { default: Modal } = await import("../../src/shared/components/Modal.js");
    const { default: HeaderMenu } = await import("../../src/shared/components/HeaderMenu.js");

    function Harness() {
      const [sheetOpen, setSheetOpen] = useState(false);
      const [modalOpen, setModalOpen] = useState(false);
      return (
        <div>
          <HeaderMenu onLogout={() => {}} />
          <button type="button" id="open-sheet" onClick={() => setSheetOpen(true)}>
            Open sheet
          </button>
          <button type="button" id="open-modal" onClick={() => setModalOpen(true)}>
            Open modal
          </button>
          <NavSheet open={sheetOpen} onClose={() => setSheetOpen(false)} variant="bottom" />
          <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Confirm action">
            <p>Modal body</p>
          </Modal>
        </div>
      );
    }

    const view = await mount(<Harness />);

    await click(view.container.querySelector("#open-sheet"));
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await click(view.container.querySelector("#open-modal"));
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(2);

    await pressEscape();
    const remainingAfterModal = [...view.container.querySelectorAll('[role="dialog"]')];
    expect(remainingAfterModal).toHaveLength(1);
    expect(remainingAfterModal[0].textContent).toContain("All pages");

    const menuTrigger = view.container.querySelector('button[aria-label="Open menu"]');
    await click(menuTrigger);
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await pressEscape();
    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await pressEscape();
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(0);

    await view.unmount();
  });

  it("bottom sheet tracks drag transform, snaps back below threshold, and closes past 64px", async () => {
    stubViewport(390);
    window.history.replaceState(null, "", "/dashboard/combos");
    const { default: NavSheet } = await import("../../src/shared/components/shell/NavSheet.js");
    let closed = 0;
    const view = await mount(
      <NavSheet
        open
        onClose={() => {
          closed += 1;
        }}
        variant="bottom"
      />,
    );

    const dialog = view.container.querySelector('[role="dialog"]');
    const handle = view.container.querySelector("[data-sheet-handle]");
    expect(dialog).not.toBeNull();
    expect(handle).not.toBeNull();

    await act(async () => {
      handle.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [{ clientY: 100 }] }));
      handle.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [{ clientY: 130 }] }));
    });
    expect(dialog.style.transform).toBe("translateY(30px)");
    expect(closed).toBe(0);

    await act(async () => {
      handle.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [{ clientY: 130 }] }));
    });
    expect(dialog.style.transform).toBe("");
    expect(closed).toBe(0);

    await act(async () => {
      handle.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [{ clientY: 100 }] }));
      handle.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [{ clientY: 180 }] }));
    });
    expect(dialog.style.transform).toBe("translateY(80px)");

    await act(async () => {
      handle.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [{ clientY: 180 }] }));
    });
    expect(closed).toBe(1);

    const closeBtn = dialog.querySelector('button[aria-label="Close"]');
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [{ clientY: 100 }] }));
      closeBtn.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [{ clientY: 130 }] }));
    });
    expect(dialog.style.transform).toBe("");
    await click(closeBtn);
    expect(closed).toBe(2);

    await view.unmount();
  });

  it.each([
    { showTitle: true, h1Count: 1 },
    { showTitle: false, h1Count: 0 },
  ])("PageHeader with showTitle=$showTitle renders its actions and $h1Count h1", async ({ showTitle, h1Count }) => {
    window.history.replaceState(null, "", "/dashboard/providers");
    const { default: PageHeader } = await import("../../src/shared/components/shell/PageHeader.js");
    const view = await mount(<PageHeader showTitle={showTitle} actions={<button type="button">Add key</button>} />);

    expect(view.container.querySelectorAll("h1")).toHaveLength(h1Count);
    expect(view.container.textContent).toContain("Add key");

    await view.unmount();
  });
});
