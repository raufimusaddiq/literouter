import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { stubReload } from "#test/dom";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/dashboard/nope" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const { routes } = await import("../../src/web/routes.js");
const { default: App, Routes } = await import("../../src/web/App.jsx");
const { navigate } = await import("../../src/web/router.js");

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: () =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
  };
}

describe("App shell", () => {
  it("unknown route renders NotFound with a link to /dashboard", async () => {
    window.history.replaceState(null, "", "/dashboard/nope");
    const view = await mount(<App />);
    expect(view.container.textContent).toContain("Page not found");
    expect(view.container.querySelector('a[href="/dashboard"]')).not.toBeNull();
    await view.unmount();
  });

  it("/ redirects to /dashboard", async () => {
    window.history.replaceState(null, "", "/");
    const view = await mount(<Routes />);
    expect(window.location.pathname).toBe("/dashboard");
    await view.unmount();
  });

  it("a failing lazy page shows the reload message instead of a blank page", async () => {
    window.history.replaceState(null, "", "/boom");
    window.sessionStorage.setItem("lr:chunk-reload", String(Date.now()));
    const reload = stubReload();
    const originalError = console.error;
    console.error = () => {};
    try {
      const view = await mount(
        <Routes
          routesOverride={[
            { path: "/boom", load: () => Promise.reject(new Error("chunk gone")), shell: false },
          ]}
        />,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(view.container.textContent).toContain("This page failed to load");
      expect(view.container.querySelector("button")?.textContent).toBe("Reload");
      expect(reload).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      console.error = originalError;
    }
  });

  it.each([
    ["has no earlier reload", null],
    ["last reloaded over 30s ago", String(Date.now() - 31_000)],
  ])("a failing lazy page reloads once when it %s", async (_name, stored) => {
    window.history.replaceState(null, "", "/boom");
    window.sessionStorage.removeItem("lr:chunk-reload");
    if (stored) window.sessionStorage.setItem("lr:chunk-reload", stored);
    const reload = stubReload();
    const originalError = console.error;
    console.error = () => {};
    try {
      const view = await mount(
        <Routes
          routesOverride={[
            { path: "/boom", load: () => Promise.reject(new Error("chunk gone")), shell: false },
          ]}
        />,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(Date.now() - Number(window.sessionStorage.getItem("lr:chunk-reload"))).toBeLessThan(5_000);
      expect(view.container.textContent).not.toContain("This page failed to load");
      await view.unmount();
    } finally {
      console.error = originalError;
    }
  });

  it("remounts the page when only the dynamic param changes, keeping the lazy cache per route", async () => {
    window.history.replaceState(null, "", "/p/a");
    let mounts = 0;
    function Page() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <span id="page" />;
    }
    const override = [{ path: "/p/:id", load: () => Promise.resolve({ default: Page }), shell: false }];
    const view = await mount(<Routes routesOverride={override} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(mounts).toBe(1);
    await act(async () => navigate("/p/b", "push"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(mounts).toBe(2);
    await act(async () => navigate("/p/b?x=1", "push"));
    expect(mounts).toBe(2);
    await view.unmount();
  });

  it("scrolls the shell container to the top on a pathname change only", async () => {
    window.history.replaceState(null, "", "/s/one");
    const Page = () => <span id="page" />;
    const override = [
      { path: "/s/one", load: () => Promise.resolve({ default: Page }), shell: true },
      { path: "/s/two", load: () => Promise.resolve({ default: Page }), shell: true },
    ];
    const view = await mount(<Routes routesOverride={override} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const scroller = view.container.querySelector("main .overflow-y-auto");
    expect(scroller).not.toBeNull();
    scroller.scrollTop = 300;
    await act(async () => navigate("/s/one?tab=x", "push"));
    expect(scroller.scrollTop).toBe(300);
    await act(async () => navigate("/s/two", "push"));
    expect(scroller.scrollTop).toBe(0);
    await view.unmount();
  });

  it("scrolls the window on a pathname change for routes without a shell", async () => {
    window.history.replaceState(null, "", "/n/one");
    const calls = [];
    const original = window.scrollTo;
    window.scrollTo = (...args) => calls.push(args);
    const Page = () => <span id="page" />;
    const override = [
      { path: "/n/one", load: () => Promise.resolve({ default: Page }), shell: false },
      { path: "/n/two", load: () => Promise.resolve({ default: Page }), shell: false },
    ];
    const view = await mount(<Routes routesOverride={override} />);
    await act(async () => navigate("/n/one?x=1", "push"));
    expect(calls).toEqual([]);
    await act(async () => navigate("/n/two", "push"));
    expect(calls).toEqual([[0, 0]]);
    window.scrollTo = original;
    await view.unmount();
  });

  it("every route page module loads and has a default export", async () => {
    for (const route of routes.filter((entry) => !entry.redirect)) {
      const mod = await route.load();
      expect(["function", "object"]).toContain(typeof mod.default);
    }
  });
});
