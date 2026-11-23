import { beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

export function setupDom(url = "http://localhost/dashboard") {
  beforeAll(() => {
    GlobalRegistrator.register({ url });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(async () => {
    await GlobalRegistrator.unregister();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
}

export class MockResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.elements = [];
    MockResizeObserver.instances.push(this);
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

export function stubMatchMedia(resolve = () => false) {
  window.matchMedia = (query) => ({
    matches: resolve(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

export function setupViewportStubs() {
  let originalResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    MockResizeObserver.instances.length = 0;
    globalThis.ResizeObserver = MockResizeObserver;
    window.ResizeObserver = MockResizeObserver;
    stubMatchMedia();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    window.ResizeObserver = originalResizeObserver;
  });
}

export async function flush(ms = 30) {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

export async function mount(element, { settle = false } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  if (settle) await flush();
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

export async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function pressKey(key, init = {}) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

export function stubReload() {
  const reload = mock(() => {});
  Object.defineProperty(window.location, "reload", { configurable: true, writable: true, value: reload });
  return reload;
}
