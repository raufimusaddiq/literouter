"use client";

import { useState, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import { useMenuKeys } from "@/shared/hooks/useMenuKeys";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const { toggleTheme, isDark } = useTheme();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useMenuKeys({ open: isOpen, setOpen: setIsOpen, triggerRef, menuRef });

  const close = (restore) => {
    setIsOpen(false);
    if (restore) triggerRef.current?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Open menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted transition-colors hover:border-line hover:text-ink"
        title="Menu"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">more_vert</span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-lg border border-line-strong bg-raise py-1 shadow-[var(--shadow-float)] fade-in"
        >
          <MenuItem
            icon={isDark ? "light_mode" : "dark_mode"}
            label="Theme"
            onClick={() => { toggleTheme(); close(true); }}
          />
          <MenuItem
            icon="logout"
            label="Logout"
            danger
            onClick={() => { close(false); onLogout(); }}
          />
        </div>
      )}
    </div>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
