"use client";

import { useEffect } from "react";

export function useMenuKeys({ open, setOpen, triggerRef, menuRef }) {
  useEffect(() => {
    if (!open) return;
    const first = menuRef?.current?.querySelector("[role=menuitem]");
    first?.focus();
  }, [open, menuRef]);

  useEffect(() => {
    if (!open) return undefined;

    const getItems = () =>
      Array.from(menuRef?.current?.querySelectorAll("[role=menuitem]") || []);

    const onMouseDown = (e) => {
      const inMenu = menuRef?.current?.contains(e.target);
      const inTrigger = triggerRef?.current?.contains(e.target);
      if (!inMenu && !inTrigger) setOpen(false);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef?.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        setOpen(false);
        return;
      }
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      e.preventDefault();
      const list = getItems();
      if (!list.length) return;
      if (e.key === "Home") {
        list[0].focus();
        return;
      }
      if (e.key === "End") {
        list[list.length - 1].focus();
        return;
      }
      const i = list.indexOf(document.activeElement);
      const next =
        e.key === "ArrowDown"
          ? (i + 1) % list.length
          : i <= 0
            ? list.length - 1
            : i - 1;
      list[next].focus();
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen, triggerRef, menuRef]);
}
