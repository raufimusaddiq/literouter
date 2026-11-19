"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

// "⋯" row menu. Rename is omitted: PUT /api/keys/[id] only accepts isActive and access.
export default function KeyRowMenu({ keyName, onCopy, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5";

  return (
    <div ref={ref} className="relative">
      <button
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
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button type="button" role="menuitem" className={`${item} text-text-main`} onClick={() => { setOpen(false); onCopy(); }}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">content_copy</span>
            Copy key
          </button>
          <button type="button" role="menuitem" className={`${item} text-red-500`} onClick={() => { setOpen(false); onDelete(); }}>
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
