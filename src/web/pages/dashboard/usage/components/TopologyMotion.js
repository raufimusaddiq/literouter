"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const GLOW_FILTER_ID = "lr-topology-glow";

const GOLDEN = 0.6180339887;
const TRAIN_PERIOD_S = 2.5;
const TRAIN_INTERVAL_S = TRAIN_PERIOD_S / 5;
const TRAIN_TRAVEL_S = 1.3;
const COMET_REACH = 117;
const SIGNAL_PERIOD_S = 3.6;
const SHIMMER_PERIOD_S = 8;
const GLINT_PERIOD_S = 6;
const BURN_MS = 2500;

const OUTBOUND = [
  { head: 3, tail: 16, width: 2.5 },
  { head: 2, tail: 10, width: 1.75 },
  { head: 2.5, tail: 13, width: 2.25 },
  { head: 1.5, tail: 8, width: 1.5 },
  { head: 2.5, tail: 14, width: 2 },
];
const RETURN = [
  { head: 2, tail: 12, width: 1.5, slot: 0.25 },
  { head: 1.5, tail: 9, width: 1.25, slot: 1.5 },
];
const IMPACTS = [0, 1];
export const RIPPLES = [0, 1, 2];

function easeInOutCubicInverse(x) {
  if (x <= 0.5) return Math.cbrt(x / 4);
  return 1 - Math.cbrt(2 * (1 - x)) / 2;
}

const ARRIVAL_S = TRAIN_TRAVEL_S * easeInOutCubicInverse(101 / (COMET_REACH + 1));

export function goldenSlot(index) {
  return (index * GOLDEN) % 1;
}

export function syncedDelay(offset, period, now = Date.now()) {
  const phase = (now / 1000) % period;
  return Number(((((offset - phase) % period) + period) % period).toFixed(3));
}

export function rippleDelay(k, now) {
  return syncedDelay(k * TRAIN_INTERVAL_S, TRAIN_INTERVAL_S * RIPPLES.length, now);
}

export function glintDelay(index) {
  return -Number((goldenSlot(index) * GLINT_PERIOD_S).toFixed(2));
}

function cometStyle(spec, delay, extra) {
  return { "--comet-delay": `${delay}s`, "--head": `${spec.head}px`, "--tail": `${spec.tail}px`, "--w": `${spec.width}px`, ...extra };
}

function Comet({ path, kind, style }) {
  return (
    <g className={`topology-comet topology-comet-${kind}`} style={style}>
      <path d={path} pathLength="100" className="topology-comet-tail" />
      <path d={path} pathLength="100" className="topology-comet-head" />
    </g>
  );
}

Comet.propTypes = {
  path: PropTypes.string.isRequired,
  kind: PropTypes.string.isRequired,
  style: PropTypes.object,
};

function useBurn(active, enabled) {
  const [shown, setShown] = useState(active && enabled);
  useEffect(() => {
    if (active && enabled) {
      setShown(true);
      return undefined;
    }
    if (!enabled) {
      setShown(false);
      return undefined;
    }
    const id = setTimeout(() => setShown(false), BURN_MS);
    return () => clearTimeout(id);
  }, [active, enabled]);
  return { shown: shown && enabled, burning: shown && enabled && !active };
}

function Signal({ path, index }) {
  const slot = goldenSlot(index);
  const base = slot * SIGNAL_PERIOD_S;
  return (
    <g className="topology-signal">
      <path
        d={path}
        pathLength="100"
        className="topology-shimmer"
        style={{ "--shimmer-delay": `${-Number((slot * SHIMMER_PERIOD_S).toFixed(2))}s` }}
      />
      {[0, 1].map((k) => (
        <Comet
          key={k}
          path={path}
          kind="signal"
          style={cometStyle(
            { head: 2, tail: 10, width: 1.25 },
            -Number(((base + (k * SIGNAL_PERIOD_S) / 2) % SIGNAL_PERIOD_S).toFixed(2)),
          )}
        />
      ))}
    </g>
  );
}

Signal.propTypes = {
  path: PropTypes.string.isRequired,
  index: PropTypes.number.isRequired,
};

function Train({ path, burning, target }) {
  const [now] = useState(() => Date.now());
  return (
    <g className={`topology-train${burning ? " is-leaving" : ""}`}>
      {OUTBOUND.map((spec, k) => (
        <Comet
          key={`o${k}`}
          path={path}
          kind="out"
          style={cometStyle(spec, syncedDelay(k * TRAIN_INTERVAL_S, TRAIN_PERIOD_S, now))}
        />
      ))}
      {RETURN.map((spec) => (
        <Comet
          key={`r${spec.slot}`}
          path={path}
          kind="return"
          style={cometStyle(spec, syncedDelay(spec.slot, TRAIN_PERIOD_S, now))}
        />
      ))}
      {target &&
        IMPACTS.map((k) => (
          <circle
            key={`i${k}`}
            cx={target.x}
            cy={target.y}
            r="4"
            className="topology-impact"
            style={{ animationDelay: `${syncedDelay(ARRIVAL_S + k * TRAIN_INTERVAL_S, TRAIN_INTERVAL_S * IMPACTS.length, now)}s` }}
          />
        ))}
    </g>
  );
}

Train.propTypes = {
  path: PropTypes.string.isRequired,
  burning: PropTypes.bool,
  target: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
};

function Shock({ path, target }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <g className="topology-shock">
      <path d={path} className="topology-shock-glow" filter={`url(#${GLOW_FILTER_ID})`} />
      <Comet path={path} kind="shock" style={cometStyle({ head: 4, tail: 24, width: 2.5 }, 0)} />
      {target && (
        <circle
          cx={target.x}
          cy={target.y}
          r="4"
          className="topology-shock-ring"
          onAnimationEnd={() => setDone(true)}
        />
      )}
    </g>
  );
}

Shock.propTypes = {
  path: PropTypes.string.isRequired,
  target: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
};

export default function EdgeMotion({ path, state = "idle", index = 0, target = null, children }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const motion = !reducedMotion;
  const active = state === "active";
  const { shown, burning } = useBurn(active, motion);

  return (
    <g className="topology-edge" data-edge-state={state}>
      {shown && (
        <g className={`topology-train${burning ? " is-leaving" : ""}`}>
          <path d={path} className="topology-edge-glow" filter={`url(#${GLOW_FILTER_ID})`} />
        </g>
      )}
      {children}
      {shown && <path d={path} pathLength="100" className={`topology-ignite${burning ? " is-burning" : ""}`} />}
      {shown && <Train path={path} burning={burning} target={target} />}
      {motion && !shown && state !== "error" && <Signal path={path} index={index} />}
      {motion && state === "error" && <Shock path={path} target={target} />}
    </g>
  );
}

EdgeMotion.propTypes = {
  path: PropTypes.string.isRequired,
  state: PropTypes.oneOf(["idle", "last", "active", "error"]),
  index: PropTypes.number,
  target: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  children: PropTypes.node,
};

export function useMotionPause(ref) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref?.current;
    let hidden = document.visibilityState === "hidden";
    let offscreen = false;
    const sync = () => setPaused(hidden || offscreen);
    const onVisibility = () => {
      hidden = document.visibilityState === "hidden";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    let observer = null;
    if (el && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        offscreen = !entries.some((entry) => entry.isIntersecting);
        sync();
      });
      observer.observe(el);
    }
    sync();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (observer) observer.disconnect();
    };
  }, [ref]);
  return paused;
}

export function GlowDefs() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
      <defs>
        <filter id={GLOW_FILTER_ID} filterUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
    </svg>
  );
}
