"use client";

import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";

const HEADER_HEIGHT = 46;
const ROW_HEIGHT = 50;
const EDGE_GAP = 6;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function curve(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export default function RouteWires({
  containerRef,
  hubRef,
  onHubTop,
  requestRefs,
  providerRefs,
  links = [],
  hot,
  newest = null,
  requestCount,
  providerCount,
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const [geom, setGeom] = useState(null);

  const measure = useCallback(() => {
    const container = containerRef?.current;
    if (!container) {
      setGeom(null);
      return;
    }

    const style = window.getComputedStyle(container);
    if (style.display === "none" || style.visibility === "hidden") {
      setGeom(null);
      return;
    }

    const box = container.getBoundingClientRect();
    const width = box.width || container.clientWidth || 200;

    const reqLimit = requestCount ?? links.length;
    const rawReqs = Array.isArray(requestRefs?.current) ? requestRefs.current.slice(0, reqLimit) : [];
    const ys = [];
    for (let i = 0; i < rawReqs.length; i += 1) {
      const node = rawReqs[i];
      if (!node) {
        ys.push(null);
        continue;
      }
      const r = node.getBoundingClientRect();
      ys.push(r.height > 0 ? r.top + r.height / 2 - box.top : HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2);
    }

    const rawProvs = Array.isArray(providerRefs?.current)
      ? (providerCount != null ? providerRefs.current.slice(0, providerCount) : providerRefs.current)
      : [];
    const pys = [];
    const provIds = [];
    for (let i = 0; i < rawProvs.length; i += 1) {
      const node = rawProvs[i];
      if (!node) {
        pys.push(null);
        provIds.push("");
        continue;
      }
      const r = node.getBoundingClientRect();
      pys.push(r.height > 0 ? r.top + r.height / 2 - box.top : HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2);
      provIds.push(node.dataset?.provider || node.dataset?.id || "");
    }

    const hubEl = hubRef?.current || container.querySelector("[data-route-hub]");
    const hubW = (hubEl?.offsetWidth || 96) / 2 + 2;

    const validPys = pys.filter((v) => v !== null);
    if (validPys.length === 0) {
      const fallbackCy = HEADER_HEIGHT + 75;
      onHubTop?.(fallbackCy);
      setGeom({ width, cy: fallbackCy, hubW, ys: [], pys: [], hotIndices: new Set() });
      return;
    }

    const allYs = [...ys, ...pys].filter((v) => v !== null);
    const cy = (Math.min(...allYs) + Math.max(...allYs)) / 2;
    onHubTop?.(cy);

    const hotIndices = new Set();
    for (const link of links) {
      if (link && link.to !== null && link.to >= 0 && link.to < pys.length && pys[link.to] !== null) {
        hotIndices.add(link.to);
      }
    }
    if (hot instanceof Set && hot.size > 0) {
      const seen = new Set();
      for (let i = 0; i < provIds.length; i += 1) {
        const pid = provIds[i];
        if (pys[i] !== null && pid && !seen.has(pid)) {
          seen.add(pid);
          if (hot.has(pid)) hotIndices.add(i);
        }
      }
    }

    setGeom({ width, cy, hubW, ys, pys, hotIndices });
  }, [containerRef, hubRef, onHubTop, requestRefs, providerRefs, links, hot, requestCount, providerCount]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) measure();
    };

    const rafId = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 0);

    run();

    if (document.fonts?.ready) {
      document.fonts.ready.then(run).catch(() => {});
    }

    const container = containerRef?.current;
    let observer = null;
    if (typeof ResizeObserver === "function" && container) {
      observer = new ResizeObserver(run);
      observer.observe(container);
      if (container.parentElement) observer.observe(container.parentElement);
    }

    window.addEventListener("resize", run);

    return () => {
      cancelled = true;
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
      } else {
        window.clearTimeout(rafId);
      }
      if (observer) observer.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [measure, containerRef]);

  if (!geom) return null;

  const { width, cy, hubW, ys, pys, hotIndices } = geom;
  const hx = width / 2;

  const hasProviders = pys.some((v) => v !== null);
  if (!hasProviders) {
    return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" />;
  }

  const newestLink = newest !== null && newest >= 0 && newest < links.length ? links[newest] : null;
  const newestFrom = newestLink && newestLink.from >= 0 && newestLink.from < ys.length && ys[newestLink.from] !== null
    ? newestLink.from
    : null;
  const newestTo = newestLink && newestLink.to !== null && newestLink.to >= 0 && newestLink.to < pys.length && pys[newestLink.to] !== null
    ? newestLink.to
    : null;

  const leftNewestD = newestFrom !== null ? curve(-EDGE_GAP, ys[newestFrom], hx - hubW, cy) : null;
  const rightNewestD = newestFrom !== null && newestTo !== null ? curve(hx + hubW, cy, width + EDGE_GAP, pys[newestTo]) : null;
  const motionPath = leftNewestD
    ? (rightNewestD ? `${leftNewestD} L${hx + hubW},${cy} ${rightNewestD.replace(/^M[^ ]+ /, "")}` : leftNewestD)
    : null;

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      {pys.map((py, i) => {
        if (py === null || (rightNewestD && i === newestTo)) return null;
        const isHot = hotIndices.has(i);
        return (
          <path
            key={`prov-${i}`}
            d={curve(hx + hubW, cy, width + EDGE_GAP, py)}
            fill="none"
            stroke={isHot ? "var(--color-wire-live)" : "var(--color-wire)"}
            strokeWidth={isHot ? 1.5 : 1}
            strokeDasharray={isHot ? undefined : "2 4"}
          />
        );
      })}
      {ys.map((y, i) => {
        if (y === null || i === newestFrom) return null;
        return (
          <path
            key={`req-${i}`}
            d={curve(-EDGE_GAP, y, hx - hubW, cy)}
            fill="none"
            stroke="var(--color-wire-live)"
            strokeWidth={1.25}
          />
        );
      })}
      {leftNewestD ? <path d={leftNewestD} fill="none" className="lr-wire-live" /> : null}
      {rightNewestD ? <path d={rightNewestD} fill="none" className="lr-wire-live" /> : null}
      {rightNewestD && newestTo !== null ? (
        <circle cx={width + EDGE_GAP} cy={pys[newestTo]} r={3} fill="var(--color-mark-line)" />
      ) : null}
      {motionPath ? (
        <circle r={2.5} className="lr-packet">
          {!reducedMotion ? <animateMotion dur="2.2s" repeatCount="indefinite" path={motionPath} /> : null}
        </circle>
      ) : null}
    </svg>
  );
}
