import { describe, it, expect } from "bun:test";
import React, { act } from "react";
import { setupDom, mount, pressKey } from "#test/dom";

setupDom();

const { default: Modal } = await import("../../src/shared/components/Modal.js");
const { default: PricingModal } = await import("../../src/shared/components/PricingModal.js");
const { default: Drawer } = await import("../../src/shared/components/Drawer.js");
const { default: Input } = await import("../../src/shared/components/Input.js");
const { default: Select } = await import("../../src/shared/components/Select.js");
const { default: Toggle } = await import("../../src/shared/components/Toggle.js");
const { default: Pagination } = await import("../../src/shared/components/Pagination.js");

async function withView(element, run) {
  const view = await mount(element);
  try {
    await run(view.container);
  } finally {
    await view.unmount();
  }
}

describe("Route Sheet base components", () => {
  it("Drawer closes from Escape and the Close button and renders nothing while closed", async () => {
    let closed = 0;
    const onClose = () => {
      closed += 1;
    };
    await withView(
      <Drawer isOpen onClose={onClose} title="Details">
        body
      </Drawer>,
      async (container) => {
        expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Details");
        await pressKey("Escape");
        await act(async () => {
          container.querySelector('button[aria-label="Close"]').click();
        });
        expect(closed).toBe(2);
      },
    );
    await withView(
      <Drawer isOpen={false} onClose={onClose} title="Details">
        body
      </Drawer>,
      (container) => {
        expect(container.innerHTML).toBe("");
      },
    );
  });

  it.each([
    { name: "Input", tag: "input", error: "Bad value", hint: "A hint", expected: "Bad value" },
    { name: "Select", tag: "select", error: "Bad value", hint: undefined, expected: "Bad value" },
    { name: "Input", tag: "input", error: undefined, hint: "A hint", expected: "A hint" },
    { name: "Select", tag: "select", error: undefined, hint: "A hint", expected: "A hint" },
  ])("$name with error=$error hint=$hint links its label and shows $expected", async ({ tag, error, hint, expected }) => {
    const props = { label: "Field", value: "", onChange: () => {}, required: true, error, hint };
    const element =
      tag === "input" ? <Input {...props} /> : <Select options={[{ value: "a", label: "A" }]} {...props} />;
    await withView(element, (container) => {
      const field = container.querySelector(tag);
      const label = container.querySelector("label");
      expect(label.getAttribute("for")).toBe(field.id);
      expect(label.textContent).toContain("*");
      expect(field.getAttribute("aria-invalid")).toBe(error ? "true" : null);
      expect(Boolean(container.querySelector('[role="alert"]'))).toBe(Boolean(error));
      expect(document.getElementById(field.getAttribute("aria-describedby")).textContent).toContain(expected);
    });
  });

  it("Toggle reports the flipped value and ignores clicks while disabled", async () => {
    const values = [];
    await withView(
      <div>
        <Toggle checked={false} onChange={(v) => values.push(v)} label="Enabled" description="Turns it on" />
        <Toggle checked disabled onChange={(v) => values.push(v)} aria-label="Locked" />
      </div>,
      async (container) => {
        const [enabled, locked] = container.querySelectorAll('[role="switch"]');
        expect(enabled.getAttribute("aria-checked")).toBe("false");
        expect(container.textContent).toContain("Turns it on");
        await act(async () => {
          enabled.click();
          locked.click();
        });
        expect(values).toEqual([true]);
      },
    );
  });

  it.each([
    { currentPage: 10, totalItems: 200, range: "Showing 91 to 100 of 200 results", jumps: ["1", "20"], prevDisabled: false, nextDisabled: false, pages: [9, 11, 1, 20] },
    { currentPage: 1, totalItems: 30, range: "Showing 1 to 10 of 30 results", jumps: [], prevDisabled: true, nextDisabled: false, pages: [2] },
    { currentPage: 3, totalItems: 30, range: "Showing 21 to 30 of 30 results", jumps: [], prevDisabled: false, nextDisabled: true, pages: [2] },
  ])("Pagination on page $currentPage of $totalItems items navigates and resizes", async ({ currentPage, totalItems, range, jumps, prevDisabled, nextDisabled, pages: expectedPages }) => {
    const pages = [];
    const sizes = [];
    await withView(
      <Pagination
        currentPage={currentPage}
        pageSize={10}
        totalItems={totalItems}
        onPageChange={(page) => pages.push(page)}
        onPageSizeChange={(size) => sizes.push(size)}
      />,
      async (container) => {
        const prev = container.querySelector('button[aria-label="Previous page"]');
        const next = container.querySelector('button[aria-label="Next page"]');
        expect(container.textContent).toContain(range);
        expect(prev.disabled).toBe(prevDisabled);
        expect(next.disabled).toBe(nextDisabled);
        const jumpButtons = jumps.map((text) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text));
        await act(async () => {
          for (const button of [prev, next, ...jumpButtons]) button.click();
        });
        expect(pages).toEqual(expectedPages);
        const select = container.querySelector("select");
        await act(async () => {
          select.value = "50";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(sizes).toEqual([50]);
      },
    );
  });

  it("Modal is a modal dialog and closes on Escape", async () => {
    let closed = 0;
    await withView(
      <Modal
        isOpen
        title="X"
        onClose={() => {
          closed += 1;
        }}
      >
        content
      </Modal>,
      async (container) => {
        expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
        await pressKey("Escape");
        expect(closed).toBe(1);
      },
    );
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
    const view = await mount(<PricingModal isOpen onClose={() => { calls += 1; }} onSave={() => {}} />, { settle: true });
    try {
      if (saving) {
        const save = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Save Changes"));
        await act(async () => {
          save.click();
        });
      }
      await pressKey("Escape");
      await act(async () => {
        document.querySelector('button[aria-label="Close"]').click();
      });
      expect(calls).toBe(expectedCalls);
    } finally {
      globalThis.fetch = originalFetch;
      await view.unmount();
    }
  });
});
