"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  BaseEdge,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { classifyConnection, HEALTH, ATTENTION_REASONS } from "@/shared/utils/connectionHealth";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import LogoMark from "@/shared/components/shell/LogoMark";
import EdgeMotion, {
  GlowDefs,
  REDUCED_MOTION_QUERY,
  RIPPLES,
  arrivalTickDelay,
  glintDelay,
  rippleDelay,
  useMotionPause,
  useNodeFx,
} from "./TopologyMotion";

const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;

const STATUS_DOT = {
  ok: "bg-ok",
  warning: "bg-warning",
  danger: "bg-danger",
  idle: "bg-muted",
};

const STATUS_GLINT = {
  ok: "border-ok",
  idle: "border-faint",
};

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { name: providerId };
}

function getProviderStatus(provider, active, error) {
  if (error) return "danger";
  if (active) return "ok";
  const health = classifyConnection(provider);
  if (health.status === HEALTH.ATTENTION) {
    return health.reason === ATTENTION_REASONS.ERROR ? "danger" : "warning";
  }
  return "idle";
}

function edgeState(data) {
  if (data?.error) return "error";
  if (data?.active) return "active";
  if (data?.last) return "last";
  return "idle";
}

function ProviderNode({ data }) {
  const { providerId, label, textIcon, active, error, status = "idle", index = 0 } = data;
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const fx = useNodeFx(edgeState(data), !reducedMotion);
  const [tickDelay, setTickDelay] = useState(0);
  useEffect(() => {
    (async () => {
      setTickDelay(active ? arrivalTickDelay(Date.now()) : 0);
    })();
  }, [active]);

  const fxClass = fx ? ` is-${fx.kind}` : "";
  const dotClass = STATUS_DOT[status] || STATUS_DOT.idle;
  const glintClass = STATUS_GLINT[status];
  const borderClass = error
    ? "border-danger is-error"
    : active
      ? "border-mark-line is-active"
      : "border-line-strong";

  return (
    <div
      className={`topology-node relative flex items-center gap-2.5 px-3.5 py-2 rounded-[6px] border bg-raise text-ink min-w-[150px] ${borderClass}${fxClass}`}
      style={active ? { "--tick-delay": `${tickDelay}s` } : undefined}
    >
      {fx && <span key={fx.key} aria-hidden="true" className="topology-node-fx" data-fx={fx.kind} />}
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <div className="w-7 h-7 rounded-[6px] bg-bg flex items-center justify-center shrink-0">
        <ProviderIcon
          providerId={providerId}
          alt={label}
          size={20}
          className="w-5 h-5 rounded-sm object-contain"
          fallbackText={textIcon}
          fallbackColor="var(--color-muted)"
        />
      </div>

      <span className="text-sm font-medium truncate text-ink">
        {label}
      </span>

      <span className="relative flex h-2 w-2 shrink-0 ml-auto" data-status={status}>
        {active ? (
          <span className="topology-ping absolute inset-0 rounded-full border border-ok" />
        ) : glintClass ? (
          <span
            className={`topology-glint absolute inset-0 rounded-full border ${glintClass}`}
            style={{ animationDelay: `${glintDelay(index)}s` }}
          />
        ) : null}
        <span className={`relative inline-flex rounded-full h-2 w-2 transition-colors duration-300 ${dotClass}`} />
      </span>
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

function RouterMotion() {
  const [now] = useState(() => Date.now());
  return (
    <>
      <span aria-hidden="true" className="topology-router-halo">
        <span className="topology-router-halo-pulse" />
      </span>
      <span aria-hidden="true" className="topology-router-ripples">
        {RIPPLES.map((k) => (
          <span key={k} className="topology-router-ripple" style={{ animationDelay: `${rippleDelay(k, now)}s` }} />
        ))}
      </span>
      <svg aria-hidden="true" className="topology-orbit">
        <rect className="topology-orbit-idle" width="100%" height="100%" rx="10" pathLength="100" />
        <rect className="topology-orbit-live" width="100%" height="100%" rx="10" pathLength="100" />
      </svg>
    </>
  );
}

function RouterNode({ data }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const count = data.activeCount || 0;
  const powering = count > 0;
  return (
    <div
      className={`topology-router relative z-[1] flex items-center justify-center px-4 py-2.5 rounded-[6px] border min-w-[130px] transition-colors duration-300 ${
        powering
          ? "is-powering border-mark-line bg-mark text-mark-ink"
          : "border-line-strong bg-raise text-ink"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {!reducedMotion && <RouterMotion />}

      <span className="topology-router-logo relative mr-2 flex h-6 w-6 items-center justify-center rounded-[5px]">
        <LogoMark size={20} dotClassName="topology-router-dot" />
      </span>
      <span className="relative text-sm font-semibold">
        LiteRouter
      </span>
      {powering && (
        <span className="topology-badge relative ml-2 px-1.5 py-0.5 rounded-full bg-mark-ink text-mark text-xs font-mono font-bold tabular-nums">
          <span key={count} className="topology-count inline-block">
            {count}
          </span>
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const state = edgeState(data);

  return (
    <EdgeMotion path={edgePath} state={state} index={data?.index ?? 0} target={{ x: targetX, y: targetY }}>
      <BaseEdge id={id} path={edgePath} style={style} className={`topology-edge-path is-${state}`} />
    </EdgeMotion>
  );
}

TopologyEdge.propTypes = {
  id: PropTypes.string,
  sourceX: PropTypes.number,
  sourceY: PropTypes.number,
  targetX: PropTypes.number,
  targetY: PropTypes.number,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  style: PropTypes.object,
  data: PropTypes.object,
};

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

function buildLayout(providers, activeSet, lastSet, errorSet) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;

  const count = providers.length;

  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55);
  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }],
      edges: [],
    };
  }

  const nodes = [];
  const edges = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active, last, error) => {
    if (error) return { stroke: "var(--color-danger)", strokeWidth: 1.75, opacity: 0.9 };
    if (active) return { stroke: "var(--color-mark-line)", strokeWidth: 1.75, opacity: 0.55 };
    if (last) return { stroke: "var(--color-wire-live)", strokeWidth: 1.5, opacity: 1 };
    return { stroke: "var(--color-wire)", strokeWidth: 1, opacity: 1 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const active = activeSet.has(p.provider?.toLowerCase());
    const last = !active && lastSet.has(p.provider?.toLowerCase());
    const error = !active && errorSet.has(p.provider?.toLowerCase());
    const nodeId = `provider-${p.provider}`;
    const data = {
      providerId: p.provider,
      label: (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider,
      textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
      error,
      last,
      index: i,
      status: getProviderStatus(p, active, error),
    };

    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    let sourceHandle, targetHandle;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - 3 * Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "topology",
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: false,
      data: { active, last, error, index: i },
      style: edgeStyle(active, last, error),
    });
  });

  return { nodes, edges };
}

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }) {
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  const firstSeenRef = useRef({});
  const [tick, setTick] = useState(0);
  const [activeSet, setActiveSet] = useState(() => new Set());

  useEffect(() => {
    const seen = firstSeenRef.current;
    const now = Date.now();
    for (const p of rawActiveSet) {
      if (!seen[p]) seen[p] = now;
    }
    for (const p of Object.keys(seen)) {
      if (!rawActiveSet.has(p)) delete seen[p];
    }
    const filtered = new Set();
    for (const p of rawActiveSet) {
      const ts = seen[p];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
    }
    (async () => {
      setActiveSet(filtered);
    })();
  }, [rawActiveSet, tick]);

  useEffect(() => {
    if (rawActiveSet.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet),
    [providers, activeSet, lastSet, errorSet]
  );

  const providersKey = useMemo(
    () => providers.map((p) => p.provider).sort().join(","),
    [providers]
  );

  const rfInstance = useRef(null);
  const containerRef = useRef(null);
  const motionPaused = useMotionPause(containerRef);
  const fitOpts = { padding: 0.2, duration: 200 };
  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView(fitOpts), 50);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rfInstance.current) rfInstance.current.fitView(fitOpts);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current.fitView(fitOpts), 50);
      return () => clearTimeout(id);
    }
  }, [nodes.length]);

  return (
    <div
      ref={containerRef}
      data-motion={motionPaused ? "paused" : "running"}
      className="topology relative h-[320px] w-full min-w-0 rounded-lg border border-line-strong bg-bg sm:h-[480px]"
    >
      <GlowDefs />
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
  })),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
