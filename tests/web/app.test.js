import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

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
    const view = await mount(
      <Routes
        routesOverride={[
          { path: "/", redirect: "/dashboard" },
          { path: "/dashboard", load: async () => ({ default: () => <p>home</p> }), shell: false },
        ]}
      />,
    );
    expect(window.location.pathname).toBe("/dashboard");
    await view.unmount();
  });

  it("a failing lazy page shows the reload message instead of a blank page", async () => {
    window.history.replaceState(null, "", "/boom");
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
      await view.unmount();
    } finally {
      console.error = originalError;
    }
  });

  it("every route page module loads and has a default export", async () => {
    for (const route of routes.filter((entry) => !entry.redirect)) {
      const mod = await route.load();
      expect(["function", "object"]).toContain(typeof mod.default);
    }
  });
});
