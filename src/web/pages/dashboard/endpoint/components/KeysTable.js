"use client";

import { formatDate } from "@/shared/utils/dateTime";
import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Button, Toggle } from "@/shared/components";
import KeyAccessControls from "./KeyAccessControls";
import KeyBudgetControls from "./KeyBudgetControls";
import KeyRowMenu from "./KeyRowMenu";
import { maskKey, relativeTime, sortKeysByLastUsed } from "../keyFormat";

const COLS = "lg:grid-cols-[minmax(180px,1fr)_208px_120px_120px_110px_150px_130px_48px]";
const iconBtn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line";

function accessLabel(key) {
  const a = key.access;
  return a?.restricted ? `Restricted · ${a.allow?.length || 0}` : "All models";
}

export default function KeysTable({
  keys, usage, usageState = "ready", copied, onCopy, onCreate, onToggle, onDelete, onUpdateAccess, onUpdateBudget, onRequestRestrict,
}) {
  const reqText = (u) => (usageState === "loading" ? "…" : usageState === "error" ? "—" : (u?.requests24h ?? 0).toLocaleString());
  const lastText = (u) => (usageState === "loading" ? "…" : usageState === "error" ? "—" : relativeTime(u?.lastUsed));
  const [visible, setVisible] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const sorted = useMemo(() => sortKeysByLastUsed(keys, usage), [keys, usage]);

  const toggleVisible = (id) => setVisible((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (keys.length === 0) {
    return (
      <Card>
        <div className="py-10 text-center">
          <p className="mb-4 text-sm text-muted">No keys yet. Create a key to call the endpoint.</p>
          <Button icon="add" onClick={onCreate}>Create key</Button>
        </div>
      </Card>
    );
  }

  const keyCell = (k) => (
    <div className="flex min-w-0 items-center">
      <code className="min-w-0 truncate font-mono text-[12px] tracking-[-0.01em] text-muted">{visible.has(k.id) ? k.key : maskKey(k.key)}</code>
      <button type="button" onClick={() => toggleVisible(k.id)} className={iconBtn}
        aria-label={`${visible.has(k.id) ? "Hide" : "Show"} key ${k.name}`}>
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{visible.has(k.id) ? "visibility_off" : "visibility"}</span>
      </button>
      <button type="button" onClick={() => onCopy(k.key, k.id)} className={iconBtn}
        aria-label={copied === k.id ? "Copied" : `Copy key ${k.name}`}>
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{copied === k.id ? "check" : "content_copy"}</span>
      </button>
    </div>
  );
  const statusToggle = (k) => {
    const active = k.isActive !== false;
    return (
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${active ? "bg-ok" : "bg-faint"}`} />
        <Toggle size="sm" checked={active} label={active ? "Active" : "Paused"}
          aria-label={`${active ? "Pause" : "Resume"} key ${k.name}`} onChange={(checked) => onToggle(k, checked)} />
      </div>
    );
  };
  const accessBtn = (k) => (
    <button type="button" onClick={() => setExpanded(expanded === k.id ? null : k.id)}
      aria-expanded={expanded === k.id}
      aria-label={`Access for ${k.name}: ${accessLabel(k)}`}
      className="inline-flex min-h-11 items-center gap-1 rounded text-[13px] text-ink transition-colors hover:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-line">
      {accessLabel(k)}
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{expanded === k.id ? "expand_less" : "expand_more"}</span>
    </button>
  );

  return (
    <Card padding="none">
      <div role="table" aria-label="API keys" className="min-w-0 border-t border-line-strong">
        <div role="row" className={`hidden items-center gap-3 border-b border-line px-1 py-2 text-[12.5px] font-medium text-faint lg:grid ${COLS}`}>
          <span role="columnheader">Name</span>
          <span role="columnheader">Key</span>
          <span role="columnheader" className="text-right">Requests 24h</span>
          <span role="columnheader">Last used</span>
          <span role="columnheader">Created</span>
          <span role="columnheader">Access</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" className="sr-only">Actions</span>
        </div>
        {sorted.map((k) => {
          const u = usage?.[k.id];
          const paused = k.isActive === false;
          const menu = <KeyRowMenu keyName={k.name} onCopy={() => onCopy(k.key, k.id)} onDelete={() => onDelete(k)} />;
          return (
            <div key={k.id} role="rowgroup" className="border-b border-line last:border-b-0">
              <div role="row" className={`hidden min-h-12 items-center gap-3 px-1 lg:grid ${COLS} ${paused ? "opacity-70" : ""}`}>
                <span role="cell" className="truncate text-sm font-semibold text-ink" title={k.name}>{k.name}</span>
                <span role="cell">{keyCell(k)}</span>
                <span role="cell" className="text-right font-mono text-[12.5px] tabular-nums text-ink">{reqText(u)}</span>
                <span role="cell" className="text-[13px] text-muted">{lastText(u)}</span>
                <span role="cell" className="font-mono text-[12.5px] tabular-nums text-muted">{formatDate(k.createdAt)}</span>
                <span role="cell">{accessBtn(k)}</span>
                <span role="cell">{statusToggle(k)}</span>
                <span role="cell">{menu}</span>
              </div>
              <div role="row" className={`flex flex-col gap-1 px-1 py-3 lg:hidden ${paused ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{k.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {statusToggle(k)}
                    {menu}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
                  {keyCell(k)}
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {(u?.requests24h ?? 0).toLocaleString()} req · {relativeTime(u?.lastUsed)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  {accessBtn(k)}
                  <span className="font-mono tabular-nums">Created {formatDate(k.createdAt)}</span>
                </div>
              </div>
              {expanded === k.id && (
                <div className="border-t border-line bg-bg-alt/50 px-3 pb-3">
                  <KeyAccessControls
                    apiKey={k}
                    onChange={(access) => onUpdateAccess(k.id, access)}
                    onRequestRestrict={() => onRequestRestrict(k)}
                  />
                  <KeyBudgetControls apiKey={k} onChange={(budget) => onUpdateBudget(k.id, budget)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

KeysTable.propTypes = {
  keys: PropTypes.array.isRequired,
  usage: PropTypes.object,
  usageState: PropTypes.oneOf(["loading", "ready", "error"]),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  onToggle: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onUpdateAccess: PropTypes.func.isRequired,
  onUpdateBudget: PropTypes.func.isRequired,
  onRequestRestrict: PropTypes.func.isRequired,
};
