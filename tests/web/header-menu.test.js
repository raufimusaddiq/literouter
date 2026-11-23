import { describe, it, expect } from "bun:test";
import React, { act } from "react";
import { setupDom, mount, click, pressKey } from "#test/dom";

setupDom();

const { default: HeaderMenu } = await import("../../src/shared/components/HeaderMenu.js");
const { default: KeyRowMenu } = await import(
  "../../src/web/pages/dashboard/endpoint/components/KeyRowMenu.js"
);

describe("HeaderMenu accessibility and keyboard navigation", () => {
  it("renders role=menu with role=menuitem children and focuses the first item on open", async () => {
    const view = await mount(<HeaderMenu onLogout={() => {}} />);
    const trigger = view.container.querySelector('button[aria-label="Open menu"]');
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await click(trigger);

    const menu = view.container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(items.length).toBe(2);
    expect(document.activeElement === items[0]).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });

  it("moves focus with ArrowDown, ArrowUp, Home, and End with wrapping", async () => {
    const view = await mount(<HeaderMenu onLogout={() => {}} />);
    const trigger = view.container.querySelector('button[aria-label="Open menu"]');
    await click(trigger);

    const items = [...view.container.querySelectorAll('[role="menu"] [role="menuitem"]')];
    expect(document.activeElement === items[0]).toBe(true);

    await pressKey("ArrowDown");
    expect(document.activeElement === items[1]).toBe(true);

    await pressKey("ArrowDown");
    expect(document.activeElement === items[0]).toBe(true);

    await pressKey("ArrowUp");
    expect(document.activeElement === items[1]).toBe(true);

    await pressKey("Home");
    expect(document.activeElement === items[0]).toBe(true);

    await pressKey("End");
    expect(document.activeElement === items[1]).toBe(true);

    await view.unmount();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const view = await mount(<HeaderMenu onLogout={() => {}} />);
    const trigger = view.container.querySelector('button[aria-label="Open menu"]');
    await click(trigger);
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();

    await pressKey("Escape");

    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement === trigger).toBe(true);
    await view.unmount();
  });

  it("closes on Tab and on mousedown outside, and toggles cleanly on trigger click", async () => {
    const view = await mount(<HeaderMenu onLogout={() => {}} />);
    const trigger = view.container.querySelector('button[aria-label="Open menu"]');

    await click(trigger);
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();

    await pressKey("Tab");
    expect(view.container.querySelector('[role="menu"]')).toBeNull();

    await click(trigger);
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(view.container.querySelector('[role="menu"]')).toBeNull();

    await click(trigger);
    expect(view.container.querySelector('[role="menu"]')).not.toBeNull();

    await click(trigger);
    expect(view.container.querySelector('[role="menu"]')).toBeNull();

    await view.unmount();
  });
});

describe("KeyRowMenu", () => {
  it("runs the selected item, closes the menu and returns focus to the trigger", async () => {
    let copied = 0;
    let deleted = 0;
    const view = await mount(
      <KeyRowMenu
        keyName="primary-key"
        onCopy={() => {
          copied += 1;
        }}
        onDelete={() => {
          deleted += 1;
        }}
      />,
    );
    const trigger = view.container.querySelector('button[aria-label="More actions for primary-key"]');
    await click(trigger);

    await click(view.container.querySelectorAll('[role="menuitem"]')[0]);

    expect(copied).toBe(1);
    expect(deleted).toBe(0);
    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);

    await view.unmount();
  });
});
