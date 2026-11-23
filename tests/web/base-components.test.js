import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/dashboard" });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const { default: Card } = await import("../../src/shared/components/Card.js");
const { default: Button } = await import("../../src/shared/components/Button.js");
const { default: Modal, ConfirmModal } = await import("../../src/shared/components/Modal.js");
const { default: PricingModal } = await import("../../src/shared/components/PricingModal.js");
const { default: Drawer } = await import("../../src/shared/components/Drawer.js");
const { default: Input } = await import("../../src/shared/components/Input.js");
const { default: Select } = await import("../../src/shared/components/Select.js");
const { default: Toggle } = await import("../../src/shared/components/Toggle.js");
const { default: Badge } = await import("../../src/shared/components/Badge.js");
const { default: SegmentedControl } = await import("../../src/shared/components/SegmentedControl.js");
const { default: Tooltip } = await import("../../src/shared/components/Tooltip.js");
const { default: Pagination } = await import("../../src/shared/components/Pagination.js");
const { Skeleton, CardSkeleton } = await import("../../src/shared/components/Loading.js");

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

describe("Route Sheet base components", () => {
  it("Card raised renders a bordered raise surface", async () => {
    const view = await mount(
      <Card variant="raised" title="T">
        x
      </Card>,
    );
    const root = view.container.firstElementChild;
    expect(root.className).toContain("bg-raise");
    expect(root.className).toContain("border");
    expect(root.className).toContain("border-line-strong");
    expect(root.className).not.toMatch(/shadow/);
    expect(view.container.querySelector("h2")?.textContent).toBe("T");
    await view.unmount();
  });

  it("Card section default has no shadow class", async () => {
    const view = await mount(
      <Card title="Section" elev>
        body
      </Card>,
    );
    const root = view.container.firstElementChild;
    expect(root.className).not.toMatch(/shadow/);
    expect(root.className).toContain("border-t");
    expect(root.className).toContain("border-line-strong");
    expect(root.className).not.toContain("bg-surface");
    expect(root.className).not.toContain("rounded");
    await view.unmount();
  });

  it("Modal renders no traffic lights and keeps dialog semantics", async () => {
    let closed = 0;
    const view = await mount(
      <Modal
        isOpen
        title="X"
        onClose={() => {
          closed += 1;
        }}
        showTrafficLights
      >
        content
      </Modal>,
    );
    const dialog = view.container.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(view.container.querySelector(".traffic-light")).toBeNull();
    expect(view.container.innerHTML).not.toContain("#FF5F56");
    expect(view.container.firstElementChild.className).toContain("z-[60]");
    expect(dialog.className).toContain("bg-raise");
    expect(dialog.className).toContain("shadow-[var(--shadow-float)]");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closed).toBe(1);
    await view.unmount();
  });

  it("Button primary is the inverted ink style", async () => {
    const view = await mount(<Button variant="primary">Save</Button>);
    const btn = view.container.querySelector("button");
    expect(btn.className).toContain("bg-ink");
    expect(btn.className).toContain("text-bg");
    expect(btn.className).toContain("h-8");
    expect(btn.className).not.toMatch(/shadow/);
    await view.unmount();
  });

  it("Button danger is outlined by default and filled inside ConfirmModal", async () => {
    const plain = await mount(<Button variant="danger">Delete</Button>);
    const plainBtn = plain.container.querySelector("button");
    expect(plainBtn.className).toContain("border-danger");
    expect(plainBtn.className).toContain("text-danger");
    expect(plainBtn.className).not.toContain("bg-danger ");
    await plain.unmount();

    const confirm = await mount(
      <ConfirmModal isOpen onClose={() => {}} onConfirm={() => {}} message="Sure?" confirmText="Delete now" />,
    );
    const buttons = [...confirm.container.querySelectorAll("button")];
    const confirmBtn = buttons.find((b) => b.textContent.includes("Delete now"));
    expect(confirmBtn).not.toBeUndefined();
    expect(confirmBtn.className).toContain("bg-danger");
    await confirm.unmount();
  });

  it("Input and Select use 36px raise fields with mark-line focus ring", async () => {
    const view = await mount(
      <div>
        <Input label="Name" value="" onChange={() => {}} />
        <Select label="Mode" value="" onChange={() => {}} options={[{ value: "a", label: "A" }]} />
      </div>,
    );
    const input = view.container.querySelector("input");
    const select = view.container.querySelector("select");
    for (const el of [input, select]) {
      expect(el.className).toContain("h-9");
      expect(el.className).toContain("bg-raise");
      expect(el.className).toContain("border-line-strong");
      expect(el.className).toContain("focus:ring-mark-line");
    }
    await view.unmount();
  });

  it("Toggle uses ink when checked", async () => {
    const view = await mount(<Toggle checked onChange={() => {}} label="Enabled" />);
    const sw = view.container.querySelector('[role="switch"]');
    expect(sw.className).toContain("bg-ink");
    expect(sw.innerHTML).not.toMatch(/shadow/);
    await view.unmount();
  });

  it("Badge renders dot plus text by default with semantic ok colour", async () => {
    const view = await mount(
      <Badge variant="success" size="sm">
        Ready
      </Badge>,
    );
    const badge = view.container.firstElementChild;
    expect(badge.className).toContain("text-ok");
    expect(badge.className).toContain("text-[11px]");
    expect(badge.querySelector(".bg-ok")).not.toBeNull();
    await view.unmount();
  });

  it("SegmentedControl uses a 1px track and inverted ink active segment", async () => {
    const view = await mount(
      <SegmentedControl
        value="24h"
        onChange={() => {}}
        options={[
          { value: "today", label: "Today" },
          { value: "24h", label: "24h" },
        ]}
      />,
    );
    const track = view.container.firstElementChild;
    expect(track.className).toContain("border");
    expect(track.className).toContain("border-line-strong");
    const active = [...track.querySelectorAll("button")].find((b) => b.textContent === "24h");
    expect(active.className).toContain("bg-ink");
    expect(active.className).toContain("text-bg");
    await view.unmount();
  });

  it("Drawer uses z-60, raise surface, float shadow and no backdrop blur", async () => {
    const view = await mount(
      <Drawer isOpen onClose={() => {}} title="Details">
        body
      </Drawer>,
    );
    expect(view.container.firstElementChild.className).toContain("z-[60]");
    expect(view.container.innerHTML).not.toContain("backdrop-blur");
    expect(view.container.innerHTML).toContain("bg-raise");
    expect(view.container.innerHTML).toContain("shadow-[var(--shadow-float)]");
    await view.unmount();
  });

  it("Tooltip uses a raise box with no arrow", async () => {
    const view = await mount(
      <Tooltip text="Hint">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const tip = view.container.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip.className).toContain("bg-raise");
    expect(tip.className).toContain("border-line-strong");
    expect(tip.children.length).toBe(0);
    await view.unmount();
  });

  it("Pagination renders text navigation buttons", async () => {
    const view = await mount(
      <Pagination currentPage={2} pageSize={10} totalItems={50} onPageChange={() => {}} />,
    );
    const prev = view.container.querySelector('button[aria-label="Previous page"]');
    const next = view.container.querySelector('button[aria-label="Next page"]');
    expect(prev.textContent.trim()).toBe("Prev");
    expect(next.textContent.trim()).toBe("Next");
    await view.unmount();
  });

  it("Skeleton and CardSkeleton are flat bg-surface-2 with no shimmer or shadow", async () => {
    const view = await mount(
      <div>
        <Skeleton className="h-4 w-20" />
        <CardSkeleton />
      </div>,
    );
    expect(view.container.innerHTML).toContain("bg-surface-2");
    expect(view.container.innerHTML).not.toContain("animate-pulse");
    expect(view.container.innerHTML).not.toMatch(/shadow/);
    await view.unmount();
  });

  it.each([
    { saving: true, expectedCalls: 0 },
    { saving: false, expectedCalls: 2 },
  ])("PricingModal with saving=$saving closes via Escape and the X $expectedCalls times", async ({ saving, expectedCalls }) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (init?.method === "PATCH" && saving) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };
    let calls = 0;
    const view = await mount(<PricingModal isOpen onClose={() => { calls += 1; }} onSave={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    if (saving) {
      const save = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Save Changes"));
      await act(async () => {
        save.click();
      });
    }
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      document.querySelector('button[aria-label="Close"]').click();
    });
    expect(calls).toBe(expectedCalls);
    globalThis.fetch = originalFetch;
    await view.unmount();
  });
});
