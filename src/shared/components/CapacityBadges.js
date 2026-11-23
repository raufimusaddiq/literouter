"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "./Tooltip";

export default function CapacityBadges({ caps, className = "", colorOverride, size = 16, focusable = false }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => {
        const meta = CAPACITY_META[k];
        const icon = (
          <span
            aria-hidden="true"
            className="material-symbols-outlined leading-none"
            style={{ fontSize: `${size}px` }}
          >
            {meta.icon}
          </span>
        );
        if (focusable) {
          return (
            <Tooltip key={k} text={`${meta.label} — ${meta.desc}`}>
              <span
                role="img"
                tabIndex={0}
                aria-label={meta.label}
                className={`rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-primary leading-none cursor-help ${colorOverride || meta.color}`}
              >
                {icon}
              </span>
            </Tooltip>
          );
        }
        return (
          <span key={k} className={`leading-none ${colorOverride || meta.color}`}>
            <span aria-hidden="true" title={`${meta.label} — ${meta.desc}`} className="material-symbols-outlined leading-none" style={{ fontSize: `${size}px` }}>
              {meta.icon}
            </span>
            <span className="sr-only">{meta.label}</span>
          </span>
        );
      })}
    </span>
  );
}
