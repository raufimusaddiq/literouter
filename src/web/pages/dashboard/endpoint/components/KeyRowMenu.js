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

  const item = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-line/60";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${keyName}`}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">more_horiz</span>
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-line-strong bg-raise py-1 shadow-float">
          <button type="button" role="menuitem" tabIndex={-1} className={`${item} text-ink`} onClick={() => { close(true); onCopy(); }}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">content_copy</span>
            Copy key
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={`${item} text-danger`} onClick={() => { close(true); onDelete(); }}>
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
