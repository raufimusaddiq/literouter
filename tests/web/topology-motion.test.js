import { describe, it, expect } from "bun:test";
import React, { act } from "react";
import { setupDom, setupViewportStubs, stubMatchMedia, mount } from "#test/dom";

setupDom("http://localhost:20128/dashboard/usage");
setupViewportStubs();

const PATH = "M0,0 C50,0 50,100 100,100";

async function renderEdge(state, { reduced = false } = {}) {
  stubMatchMedia((query) => reduced && query.includes("reduce"));
  const { default: EdgeMotion } = await import("../../src/web/pages/dashboard/usage/components/TopologyMotion.js");
  return mount(
    <svg>
      <EdgeMotion path={PATH} state={state} index={3} target={{ x: 100, y: 100 }}>
        <path className="base" d={PATH} />
      </EdgeMotion>
    </svg>,
  );
}

describe("topology edge motion", () => {
  it("runs an outbound comet train, return comets, arrival rings and a glow on an active edge", async () => {
    const view = await renderEdge("active");
    const svg = view.container.querySelector("svg");
    expect(svg.querySelectorAll(".topology-comet-out").length).toBe(5);
    expect(svg.querySelectorAll(".topology-comet-return").length).toBe(2);
    expect(svg.querySelectorAll(".topology-impact").length).toBe(2);
    expect(svg.querySelectorAll(".topology-comet-out .topology-comet-halo").length).toBe(5);
    expect(svg.querySelector(".topology-edge-glow")).not.toBeNull();
    expect(svg.querySelector(".topology-signal")).toBeNull();
    await view.unmount();
  });

  it.each(["idle", "last"])("keeps a low-contrast signal stream alive on a %s edge", async (state) => {
    const view = await renderEdge(state);
    const svg = view.container.querySelector("svg");
    expect(svg.querySelectorAll(".topology-comet-signal").length).toBe(2);
    expect(svg.querySelector(".topology-shimmer")).not.toBeNull();
    expect(svg.querySelector(".topology-comet-out")).toBeNull();
    await view.unmount();
  });

  it("sends a single shock pulse down an error edge instead of the signal", async () => {
    const view = await renderEdge("error");
    const svg = view.container.querySelector("svg");
    expect(svg.querySelectorAll(".topology-comet-shock").length).toBe(1);
    expect(svg.querySelector(".topology-signal")).toBeNull();
    await view.unmount();
  });

  it.each(["active", "idle", "error"])("renders only the static edge under reduced motion (%s)", async (state) => {
    const view = await renderEdge(state, { reduced: true });
    const svg = view.container.querySelector("svg");
    expect(svg.querySelector(".base")).not.toBeNull();
    expect(svg.querySelectorAll(".topology-edge > *").length).toBe(1);
    await view.unmount();
  });

  it("burns an edge down after its request ends, then returns it to the signal", async () => {
    stubMatchMedia(() => false);
    const { default: EdgeMotion } = await import("../../src/web/pages/dashboard/usage/components/TopologyMotion.js");
    const tree = (state) => (
      <svg>
        <EdgeMotion path={PATH} state={state} index={0}>
          <path d={PATH} />
        </EdgeMotion>
      </svg>
    );
    const view = await mount(tree("active"));
    await view.rerender(tree("last"));
    const svg = view.container.querySelector("svg");
    expect(svg.querySelector(".topology-ignite.is-burning")).not.toBeNull();
    expect(svg.querySelector(".topology-train.is-leaving")).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2600));
    });
    expect(svg.querySelector(".topology-ignite")).toBeNull();
    expect(svg.querySelectorAll(".topology-comet-signal").length).toBe(2);
    await view.unmount();
  });
});

describe("topology motion pause", () => {
  it("pauses while the tab is hidden", async () => {
    const { useMotionPause } = await import("../../src/web/pages/dashboard/usage/components/TopologyMotion.js");
    function Probe() {
      const ref = React.useRef(null);
      const paused = useMotionPause(ref);
      return <div ref={ref} data-motion={paused ? "paused" : "running"} />;
    }
    const view = await mount(<Probe />);
    const el = view.container.firstChild;
    expect(el.getAttribute("data-motion")).toBe("running");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(el.getAttribute("data-motion")).toBe("paused");
    delete document.visibilityState;
    await view.unmount();
  });
});

describe("provider card motion", () => {
  it.each([
    ["idle", "active", "hit"],
    ["last", "active", "hit"],
    ["active", "last", "done"],
    ["active", "idle", "done"],
    ["active", "error", null],
    ["idle", "error", null],
    ["idle", "idle", null],
  ])("reacts to %s -> %s with %p", async (before, after, kind) => {
    const { nodeFxFor } = await import("../../src/web/pages/dashboard/usage/components/TopologyMotion.js");
    expect(nodeFxFor(before, after)).toBe(kind);
  });

  it("bursts when a stream starts, clears after the effect, and stays still under reduced motion", async () => {
    const { useNodeFx, NODE_FX_MS } = await import("../../src/web/pages/dashboard/usage/components/TopologyMotion.js");
    function Card({ state, enabled }) {
      const fx = useNodeFx(state, enabled);
      return <div data-fx={fx ? fx.kind : "none"} />;
    }
    const view = await mount(<Card state="idle" enabled />);
    const el = () => view.container.firstChild;
    await view.rerender(<Card state="active" enabled />);
    expect(el().getAttribute("data-fx")).toBe("hit");
    await act(async () => {
      await new Promise((r) => setTimeout(r, NODE_FX_MS.hit + 50));
    });
    expect(el().getAttribute("data-fx")).toBe("none");
    await view.rerender(<Card state="last" enabled={false} />);
    expect(el().getAttribute("data-fx")).toBe("none");
    await view.unmount();
  });
});
