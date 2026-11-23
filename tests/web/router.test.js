import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/dashboard/usage?tab=logs" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const {
  matchRoute,
  resolveHref,
  navigate,
  redirect,
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  ParamsProvider,
  Link,
  useScrollReset,
} = await import("../../src/web/router.js");

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

describe("matchRoute", () => {
  it("binds params", () => {
    expect(matchRoute("/dashboard/providers/:id", "/dashboard/providers/openai")).toEqual({ id: "openai" });
    expect(matchRoute("/dashboard/providers/:id", "/dashboard/providers/a%2Fb")).toEqual({ id: "a/b" });
    expect(matchRoute("/dashboard/providers/:id", "/dashboard/providers/x/")).toEqual({ id: "x" });
    expect(matchRoute("/dashboard", "/dashboard/")).toEqual({});
    expect(matchRoute("/dashboard", "/dashboard/x")).toBeNull();
    expect(matchRoute("/dashboard/providers/:id", "/dashboard/providers/%E0%A4%A")).toBeNull();
  });
});

describe("resolveHref", () => {
  it("returns same-origin paths and rejects the rest", () => {
    expect(resolveHref("?tab=logs", "http://h/dashboard/usage?x=1#a")).toBe("/dashboard/usage?tab=logs");
    expect(resolveHref("/login", "http://h/dashboard")).toBe("/login");
    expect(resolveHref("https://evil.test/x", "http://h/")).toBeNull();
    expect(resolveHref("//evil.test/x", "http://h/")).toBeNull();
  });
});

describe("hooks follow history", () => {
  it("tracks pathname, search params and popstate", async () => {
    window.history.replaceState(null, "", "/dashboard/usage?tab=logs");
    let router;
    function Probe() {
      router = useRouter();
      const pathname = usePathname();
      const params = useSearchParams();
      return React.createElement("span", { id: "probe" }, `${pathname}|${params.get("tab")}`);
    }
    const view = await mount(React.createElement(Probe));
    const text = () => view.container.querySelector("#probe").textContent;
    expect(text()).toBe("/dashboard/usage|logs");

    const before = window.history.length;
    await act(async () => router.push("/dashboard/providers"));
    expect(text()).toBe("/dashboard/providers|null");
    expect(window.history.length).toBe(before + 1);

    await act(async () => router.replace("?tab=details", { scroll: false }));
    expect(window.location.pathname).toBe("/dashboard/providers");
    expect(text()).toBe("/dashboard/providers|details");
    expect(window.history.length).toBe(before + 1);

    await act(async () => {
      window.history.pushState(null, "", "/dashboard/quota");
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    });
    expect(text()).toBe("/dashboard/quota|null");
    await view.unmount();
  });
});

describe("referential stability", () => {
  it("keeps useRouter and useSearchParams stable across re-renders with the same URL", async () => {
    window.history.replaceState(null, "", "/dashboard/usage?tab=logs");
    const routers = [];
    const params = [];
    function Probe({ n }) {
      routers.push(useRouter());
      params.push(useSearchParams());
      return React.createElement("span", null, n);
    }
    const view = await mount(React.createElement(Probe, { n: 1 }));
    await view.rerender(React.createElement(Probe, { n: 2 }));
    await view.rerender(React.createElement(Probe, { n: 3 }));
    expect(routers.length).toBeGreaterThanOrEqual(3);
    expect(new Set(routers).size).toBe(1);
    expect(new Set(params).size).toBe(1);
    await act(async () => navigate("/dashboard/usage?tab=other", "replace"));
    expect(params.at(-1)).not.toBe(params[0]);
    expect(params.at(-1).get("tab")).toBe("other");
    await view.unmount();
  });
});

describe("useParams", () => {
  it("defaults to an empty object and reads ParamsProvider", async () => {
    let bare;
    let provided;
    function Bare() {
      bare = useParams();
      return null;
    }
    function Provided() {
      provided = useParams();
      return null;
    }
    const view = await mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Bare),
        React.createElement(ParamsProvider, { params: { id: "openai" } }, React.createElement(Provided)),
      ),
    );
    expect(bare).toEqual({});
    expect(provided).toEqual({ id: "openai" });
    await view.unmount();
  });
});

describe("Link", () => {
  async function setup(props) {
    window.history.replaceState(null, "", "/dashboard");
    const view = await mount(React.createElement(Link, { id: "l", ...props }, "go"));
    return { view, a: view.container.querySelector("#l") };
  }
  function click(a, init = {}) {
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    act(() => {
      a.dispatchEvent(event);
    });
    return event;
  }

  it("navigates on plain click, calling onClick first", async () => {
    const order = [];
    const { view, a } = await setup({
      href: `/dashboard/${"providers"}`,
      onClick: () => order.push(`click@${window.location.pathname}`),
      className: "x y",
      "aria-current": "page",
    });
    expect(a.getAttribute("class")).toBe("x y");
    expect(a.getAttribute("aria-current")).toBe("page");
    expect(a.getAttribute("href")).toBe("/dashboard/providers");
    const before = window.history.length;
    const event = click(a);
    expect(order).toEqual(["click@/dashboard"]);
    expect(window.location.pathname).toBe("/dashboard/providers");
    expect(window.history.length).toBe(before + 1);
    expect(event.defaultPrevented).toBe(true);
    await view.unmount();
  });

  it("does not navigate when onClick prevents default", async () => {
    const { view, a } = await setup({ href: "/login", onClick: (e) => e.preventDefault() });
    click(a);
    expect(window.location.pathname).toBe("/dashboard");
    await view.unmount();
  });

  it("does not navigate for modified clicks, other buttons, targets or cross-origin hrefs", async () => {
    for (const [props, init] of [
      [{ href: "/login" }, { ctrlKey: true }],
      [{ href: "/login" }, { metaKey: true }],
      [{ href: "/login" }, { shiftKey: true }],
      [{ href: "/login" }, { button: 1 }],
      [{ href: "/login", target: "_blank" }, {}],
      [{ href: "https://evil.test/x" }, {}],
    ]) {
      const { view, a } = await setup(props);
      const push = spyOn(window.history, "pushState");
      const replace = spyOn(window.history, "replaceState");
      const event = click(a, init);
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      push.mockRestore();
      replace.mockRestore();
      await view.unmount();
    }
  });
});

describe("redirect", () => {
  it("replaces the current entry", () => {
    window.history.replaceState(null, "", "/dashboard");
    const before = window.history.length;
    redirect("/login");
    expect(window.location.pathname).toBe("/login");
    expect(window.history.length).toBe(before);
  });
});

describe("push to the current URL", () => {
  it("replaces instead of adding a history entry, and still pushes for a different URL", () => {
    window.history.replaceState(null, "", "/dashboard/usage?tab=logs#top");
    const before = window.history.length;
    navigate("/dashboard/usage?tab=logs#top", "push");
    expect(window.history.length).toBe(before);
    navigate("/dashboard/usage?tab=logs", "push");
    expect(window.history.length).toBe(before + 1);
    navigate("/dashboard/usage?tab=logs", "push");
    expect(window.history.length).toBe(before + 1);
  });
});

describe("useScrollReset", () => {
  async function setup(url) {
    window.history.replaceState(null, "", url);
    const holder = { el: null };
    function Probe() {
      const ref = React.useRef(null);
      holder.el = ref;
      useScrollReset(ref);
      usePathname();
      return React.createElement("div", { id: "scroller", ref });
    }
    const view = await mount(React.createElement(Probe));
    const el = view.container.querySelector("#scroller");
    el.scrollTop = 240;
    return { view, el };
  }

  it("resets scrollTop on a pathname change but not on a query-only change", async () => {
    const { view, el } = await setup("/dashboard/providers");
    await act(async () => navigate("/dashboard/providers?sortBy=name", "push"));
    expect(el.scrollTop).toBe(240);
    await act(async () => navigate("?tab=details", "replace"));
    expect(el.scrollTop).toBe(240);
    await act(async () => navigate("/dashboard/quota", "push"));
    expect(el.scrollTop).toBe(0);
    await view.unmount();
  });

  it("does not reset on popstate", async () => {
    const { view, el } = await setup("/dashboard/providers");
    await act(async () => {
      window.history.pushState(null, "", "/dashboard/quota");
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    });
    expect(el.scrollTop).toBe(240);
    await view.unmount();
  });

  it("scrolls the window when no element is given", async () => {
    window.history.replaceState(null, "", "/pricing");
    const calls = [];
    const original = window.scrollTo;
    window.scrollTo = (...args) => calls.push(args);
    function Probe() {
      useScrollReset(null);
      usePathname();
      return null;
    }
    const view = await mount(React.createElement(Probe));
    await act(async () => navigate("/pricing?x=1", "push"));
    expect(calls).toEqual([]);
    await act(async () => navigate("/login", "push"));
    expect(calls).toEqual([[0, 0]]);
    window.scrollTo = original;
    await view.unmount();
  });
});
