"use client";

import { Children, cloneElement, isValidElement, useId, useState } from "react";

// Hover/focus tooltip. The tooltip text is linked to the (single) child trigger via
// aria-describedby, shown on hover AND keyboard focus (focus-within), and Escape dismisses it.
export default function Tooltip({ text, children, position = "top", color }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);

  const posClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[position];

  const bgStyle = color ? { backgroundColor: color } : {};
  const bgClass = color ? "" : "bg-gray-900";

  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const trigger =
    only && isValidElement(only) && typeof only.type === "string"
      ? cloneElement(only, {
          "aria-describedby": [only.props["aria-describedby"], id].filter(Boolean).join(" "),
        })
      : children;

  return (
    <div
      className="relative inline-flex group/tt"
      onKeyDown={(e) => {
        if (e.key === "Escape") setDismissed(true);
      }}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
    >
      {trigger}
      <div
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute ${posClass} z-50 w-max max-w-56 rounded px-2 py-1 text-[11px] leading-snug ${bgClass} text-white ${dismissed ? "opacity-0" : "opacity-0 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100"} transition-opacity duration-150 whitespace-normal`}
        style={bgStyle}
      >
        {text}
      </div>
    </div>
  );
}
