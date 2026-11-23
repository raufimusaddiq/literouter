"use client";

import { useState, useRef } from "react";
import PropTypes from "prop-types";
import { useMenuKeys } from "@/shared/hooks/useMenuKeys";

export default function KeyRowMenu({ keyName, onCopy, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useMenuKeys({ open, setOpen, triggerRef, menuRef });

  const close = (restore) => { setOpen(false); if (restore) triggerRef.current?.focus(); };

  const item = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${keyName}`}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted transition-colors hover:bg-black/5 hover:text-text-main dark:hover:bg-white/5"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">more_horiz</span>
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button type="button" role="menuitem" tabIndex={-1} className={`${item} text-text-main`} onClick={() => { close(true); onCopy(); }}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">content_copy</span>
            Copy key
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={`${item} text-red-500`} onClick={() => { close(true); onDelete(); }}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">delete</span>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

KeyRowMenu.propTypes = {
  keyName: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
