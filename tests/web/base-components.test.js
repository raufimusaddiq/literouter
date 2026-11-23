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

const { default: Modal } = await import("../../src/shared/components/Modal.js");
const { default: PricingModal } = await import("../../src/shared/components/PricingModal.js");
const { default: Card } = await import("../../src/shared/components/Card.js");
const { default: Drawer } = await import("../../src/shared/components/Drawer.js");
const { default: Input } = await import("../../src/shared/components/Input.js");
const { default: Select } = await import("../../src/shared/components/Select.js");
const { default: Toggle } = await import("../../src/shared/components/Toggle.js");
const { default: Badge } = await import("../../src/shared/components/Badge.js");
const { default: Pagination } = await import("../../src/shared/components/Pagination.js");

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

async function withView(element, run) {
  const view = await mount(element);
  try {
    await run(view.container);
  } finally {
    await view.unmount();
  }
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("Route Sheet base components", () => {
  it("Card renders its title as an h2 with subtitle, action and children", async () => {
    await withView(
      <Card title="Section" subtitle="Sub" icon="info" action={<button type="button">Act</button>}>
        body
      </Card>,
      (container) => {
        expect(container.querySelector("h2")?.textContent).toBe("Section");
        expect(container.textContent).toContain("Sub");
        expect(container.textContent).toContain("Act");
        expect(container.textContent).toContain("body");
      },
    );
  });

  it("Drawer closes from Escape, the Close button and the backdrop", async () => {
    let closed = 0;
    await withView(
      <Drawer isOpen onClose={() => { closed += 1; }} title="Details">
        body
      </Drawer>,
      async (container) => {
        expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Details");
        expect(container.textContent).toContain("body");
        await pressEscape();
        await act(async () => {
          container.querySelector('button[aria-label="Close"]').click();
        });
        await act(async () => {
          container.firstElementChild.firstElementChild.click();
        });
        expect(closed).toBe(3);
      },
    );
  });

  it("Drawer renders nothing while closed", async () => {
    await withView(<Drawer isOpen={false} onClose={() => {}} title="Details">body</Drawer>, (container) => {
      expect(container.innerHTML).toBe("");
    });
  });

  it.each([
    ["Input", "input", (props) => <Input {...props} />],
    ["Select", "select", (props) => <Select options={[{ value: "a", label: "A" }]} {...props} />],
  ])("%s labels its field and flags errors", async (_name, tag, render) => {
    await withView(
      render({ label: "Field", value: "", onChange: () => {}, error: "Bad value", required: true }),
      (container) => {
        const field = container.querySelector(tag);
        expect(container.querySelector("label")?.getAttribute("for")).toBe(field.id);
        expect(container.querySelector("label")?.textContent).toContain("*");
        expect(field.getAttribute("aria-invalid")).toBe("true");
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain("Bad value");
        expect(field.getAttribute("aria-describedby")).toBe(alert.id);
      },
    );
  });

  it("Select reports the chosen option through onChange", async () => {
    const changes = [];
    await withView(
      <Select label="Mode" value="" onChange={(e) => changes.push(e.target.value)} options={[{ value: "a", label: "A" }]} />,
      async (container) => {
        const select = container.querySelector("select");
        await act(async () => {
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value").set.call(select, "a");
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(changes).toEqual(["a"]);
      },
    );
  });

  it.each([
    ["Input", (props) => <Input icon="search" {...props} />],
    ["Select", (props) => <Select {...props} />],
  ])("%s shows its hint only when there is no error", async (_name, render) => {
    await withView(render({ label: "F", value: "", onChange: () => {}, hint: "A hint" }), (container) => {
      expect(container.textContent).toContain("A hint");
      expect(container.querySelector('[role="alert"]')).toBeNull();
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

  it("Badge renders its label and an optional icon", async () => {
    await withView(
      <div>
        <Badge variant="success">Ready</Badge>
        <Badge icon="check" pill size="sm">Done</Badge>
      </div>,
      (container) => {
        expect(container.textContent).toContain("Ready");
        expect(container.textContent).toContain("check");
        expect(container.textContent).toContain("Done");
      },
    );
  });

  it("Pagination reports page changes, jumps to the first and last page and changes the page size", async () => {
    const pages = [];
    const sizes = [];
    await withView(
      <Pagination
        currentPage={10}
        pageSize={10}
        totalItems={200}
        onPageChange={(page) => pages.push(page)}
        onPageSizeChange={(size) => sizes.push(size)}
      />,
      async (container) => {
        expect(container.textContent).toContain("Showing 91 to 100 of 200 results");
        const buttons = [...container.querySelectorAll("button")];
        const byText = (text) => buttons.find((b) => b.textContent.trim() === text);
        await act(async () => {
          container.querySelector('button[aria-label="Previous page"]').click();
          container.querySelector('button[aria-label="Next page"]').click();
          byText("1").click();
          byText("20").click();
        });
        expect(pages).toEqual([9, 11, 1, 20]);
        const select = container.querySelector("select");
        await act(async () => {
          select.value = "50";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(sizes).toEqual([50]);
      },
    );
  });

  it("Pagination disables Prev on the first page and Next on the last", async () => {
    await withView(
      <div>
        <Pagination currentPage={1} pageSize={10} totalItems={30} onPageChange={() => {}} />
        <Pagination currentPage={3} pageSize={10} totalItems={30} onPageChange={() => {}} />
      </div>,
      (container) => {
        expect(container.querySelector('button[aria-label="Previous page"]').disabled).toBe(true);
        const nexts = container.querySelectorAll('button[aria-label="Next page"]');
        expect(nexts[0].disabled).toBe(false);
        expect(nexts[1].disabled).toBe(true);
      },
    );
  });

  it("Modal is a modal dialog and closes on Escape", async () => {
    let closed = 0;
    const view = await mount(
      <Modal
        isOpen
        title="X"
        onClose={() => {
          closed += 1;
        }}
      >
        content
      </Modal>,
    );
    try {
      expect(view.container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
      await pressEscape();
      expect(closed).toBe(1);
    } finally {
      await view.unmount();
    }
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
    try {
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
    } finally {
      globalThis.fetch = originalFetch;
      await view.unmount();
    }
  });
});
