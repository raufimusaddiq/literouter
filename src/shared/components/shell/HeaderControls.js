"use client";

import PropTypes from "prop-types";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

export function HeaderControls({ className = "" }) {
  const visible = useHeaderSearchStore((s) => s.visible);
  if (!visible) return null;

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className}`}>
      <HeaderSearch />
    </div>
  );
}

HeaderControls.propTypes = { className: PropTypes.string };

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="relative w-[160px] sm:w-[220px]">
      <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-muted">
        search
      </span>
      <input
        type="text"
        aria-label={placeholder || "Search"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-line-strong bg-raise pl-8 pr-7 text-sm text-ink placeholder:text-faint transition-[background-color,border-color,box-shadow] focus:border-mark-line focus:outline-none focus:ring-2 focus:ring-mark-line/20"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-0.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Clear search"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
        </button>
      )}
    </div>
  );
}
